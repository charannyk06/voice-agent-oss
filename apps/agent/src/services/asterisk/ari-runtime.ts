import { config } from '../../config';
import { AsteriskAriClient, type AriChannel, type AriEvent } from './ari-client';
import { AsteriskExternalMediaTransport } from './rtp';

interface CallReadyPayload {
  direction: 'inbound' | 'outbound';
  orgId: string;
  phone: string;
  providerCallId: string;
  routeKey?: string;
  transport: AsteriskExternalMediaTransport;
}

interface CallPreflightPayload {
  direction: 'inbound' | 'outbound';
  orgId?: string;
  phone: string;
  providerCallId: string;
  routeKey?: string;
}

interface CallPreflightResult {
  orgId: string;
  releaseReservation?: () => void;
}

interface CallAudioFramePayload {
  mulawBase64: string;
  providerCallId: string;
}

interface CallEndedPayload {
  providerCallId: string;
  reason: string;
}

interface AsteriskRuntimeHandlers {
  onAudioFrame: (payload: CallAudioFramePayload) => void;
  onCallEnded: (payload: CallEndedPayload) => Promise<void>;
  onCallPreflight: (payload: CallPreflightPayload) => Promise<CallPreflightResult>;
  onCallReady: (payload: CallReadyPayload) => Promise<void>;
}

interface RuntimeCallState {
  bridgeId: string;
  channelId: string;
  closing: boolean;
  direction: 'inbound' | 'outbound';
  externalChannelId: string;
  phone: string;
  transport: AsteriskExternalMediaTransport;
}

function isIgnorableAnswerError(error: unknown): boolean {
  return error instanceof Error && /ARI error (404|409|412)/i.test(error.message);
}

function parseAppArgs(args: string[] | undefined): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const entry of args || []) {
    const [key, ...rest] = entry.split('=');
    if (!key || rest.length === 0) {
      continue;
    }
    parsed[key] = rest.join('=');
  }

  return parsed;
}

function deriveDirection(channelId: string, args: Record<string, string>): 'inbound' | 'outbound' {
  if ((args.direction || '').toLowerCase() === 'outbound' || channelId.startsWith('asterisk-out-')) {
    return 'outbound';
  }
  return 'inbound';
}

function derivePhone(
  channel: AriChannel | undefined,
  direction: 'inbound' | 'outbound',
  args: Record<string, string>,
): string {
  if (direction === 'outbound') {
    return args.dialed_number || channel?.connected?.number || channel?.caller?.number || 'unknown';
  }
  return args.caller_number || channel?.caller?.number || channel?.connected?.number || 'unknown';
}

function deriveInboundRouteKey(args: Record<string, string>): string | undefined {
  return args.inbound_route || args.sip_domain || args.domain || config.asterisk.sipDomain || config.asterisk.publicHost || undefined;
}

function isExternalMediaChannel(channelId: string, channelName?: string): boolean {
  return channelId.startsWith('asterisk-ext-') || Boolean(channelName && channelName.startsWith('UnicastRTP/'));
}

function createBridgeId(channelId: string): string {
  return `asterisk-bridge-${channelId}`;
}

function createExternalMediaChannelId(channelId: string): string {
  return `asterisk-ext-${channelId}`;
}

export class AsteriskAriRuntime {
  private readonly ariClient: AsteriskAriClient;
  private readonly calls = new Map<string, RuntimeCallState>();
  private readonly reconnectDelayMs = 3000;
  private websocket: import('ws').WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastError: string | null = null;
  private connected = false;
  private started = false;

  constructor(
    private readonly handlers: AsteriskRuntimeHandlers,
    ariClient = new AsteriskAriClient(),
  ) {
    this.ariClient = ariClient;
  }

  isConfigured(): boolean {
    return this.ariClient.isConfigured() && Boolean(config.asterisk.externalMediaHost);
  }

  getStatusSnapshot(): {
    activeCallCount: number;
    configured: boolean;
    connected: boolean;
    lastError: string | null;
  } {
    return {
      activeCallCount: this.calls.size,
      configured: this.isConfigured(),
      connected: this.connected,
      lastError: this.lastError,
    };
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    if (!this.isConfigured()) {
      this.lastError = 'Asterisk runtime requires ARI credentials and ASTERISK_EXTERNAL_MEDIA_HOST.';
      return;
    }

    this.connect();
  }

  async stop(): Promise<void> {
    this.started = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    const activeChannelIds = Array.from(this.calls.keys());
    await Promise.allSettled(activeChannelIds.map((channelId) => this.cleanupCall(channelId, 'Runtime stopped')));
  }

  private connect(): void {
    if (!this.started || this.websocket || !this.isConfigured()) {
      return;
    }

    this.websocket = this.ariClient.connectEvents({
      app: config.asterisk.ariApplication,
      onOpen: () => {
        this.connected = true;
        this.lastError = null;
        console.log('[Asterisk ARI] Connected to events websocket');
      },
      onEvent: (event) => {
        void this.handleEvent(event).catch((error) => {
          console.error('[Asterisk ARI] Event handling failed:', error);
        });
      },
      onClose: (code, reason) => {
        this.connected = false;
        this.websocket = null;
        if (!this.started) {
          return;
        }

        this.lastError = `Asterisk ARI websocket closed (${code}${reason ? `: ${reason}` : ''})`;
        console.warn('[Asterisk ARI]', this.lastError);
        this.scheduleReconnect();
      },
      onError: (error) => {
        this.lastError = error.message;
        console.error('[Asterisk ARI] Websocket error:', error);
      },
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.started) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref();
  }

  private async handleEvent(event: AriEvent): Promise<void> {
    const eventType = event.type || '';
    const channelId = event.channel?.id;
    const channelName = event.channel?.name;

    if (!channelId) {
      return;
    }

    if (eventType === 'StasisStart') {
      if (isExternalMediaChannel(channelId, channelName)) {
        return;
      }

      await this.startCall(event);
      return;
    }

    if (eventType === 'StasisEnd' || eventType === 'ChannelDestroyed') {
      if (isExternalMediaChannel(channelId, channelName)) {
        const parent = Array.from(this.calls.values()).find((call) => call.externalChannelId === channelId);
        if (parent) {
          await this.cleanupCall(parent.channelId, 'External media channel ended', { hangupPrimaryChannel: true });
        }
        return;
      }

      if (this.calls.has(channelId)) {
        await this.cleanupCall(channelId, `${eventType} received`);
      }
    }
  }

  private async startCall(event: AriEvent): Promise<void> {
    const channelId = event.channel?.id;
    if (!channelId || this.calls.has(channelId)) {
      return;
    }

    if (!config.gemini.apiKey) {
      console.warn('[Asterisk ARI] GEMINI_API_KEY is missing. Rejecting Asterisk live call.');
      await this.ariClient.hangupChannel(channelId).catch((error) => {
        console.error('[Asterisk ARI] Failed to reject live call without GEMINI_API_KEY:', error);
      });
      return;
    }

    const args = parseAppArgs(event.args);
    const direction = deriveDirection(channelId, args);
    const phone = derivePhone(event.channel, direction, args);
    const routeKey = direction === 'inbound' ? deriveInboundRouteKey(args) : undefined;

    let preflight: CallPreflightResult;
    try {
      preflight = await this.handlers.onCallPreflight({
        providerCallId: channelId,
        phone,
        direction,
        orgId: args.org_id || args.orgId,
        routeKey,
      });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[Asterisk ARI] Billing preflight rejected live bridge for ${channelId}:`, error);
      await this.ariClient.hangupChannel(channelId).catch((hangupError) => {
        console.error('[Asterisk ARI] Failed to hang up billing-rejected call:', hangupError);
      });
      return;
    }

    let releaseBillingReservation = preflight.releaseReservation;
    const releaseReservation = () => {
      releaseBillingReservation?.();
      releaseBillingReservation = undefined;
    };

    const transport = new AsteriskExternalMediaTransport({
      advertisedHost: config.asterisk.externalMediaHost,
      bindAddress: config.asterisk.externalMediaBindAddress,
      bindPort: config.asterisk.externalMediaPort > 0 ? config.asterisk.externalMediaPort : undefined,
      onAudioFrame: (mulawBase64) => {
        const activeCall = this.calls.get(channelId);
        if (!activeCall || activeCall.closing) {
          return;
        }

        this.handlers.onAudioFrame({
          providerCallId: channelId,
          mulawBase64,
        });
      },
    });

    const runtimeCall: RuntimeCallState = {
      bridgeId: createBridgeId(channelId),
      channelId,
      closing: false,
      direction,
      externalChannelId: createExternalMediaChannelId(channelId),
      phone,
      transport,
    };

    this.calls.set(channelId, runtimeCall);

    try {
      const listening = await transport.start();

      await this.ariClient.createBridge({
        bridgeId: runtimeCall.bridgeId,
        name: `Voice Agent ${channelId}`,
      });

      await this.ariClient.createExternalMediaChannel({
        app: config.asterisk.ariApplication,
        channelId: runtimeCall.externalChannelId,
        externalHost: `${listening.host}:${listening.port}`,
        format: 'ulaw',
        variables: {
          VOICE_AGENT_CHANNEL: channelId,
          VOICE_AGENT_ROLE: 'external-media',
        },
      });

      await this.ariClient.addChannelsToBridge(runtimeCall.bridgeId, [runtimeCall.externalChannelId]);

      const [remoteAddress, remotePort] = await Promise.all([
        this.ariClient.getChannelVariable(runtimeCall.externalChannelId, 'UNICASTRTP_LOCAL_ADDRESS'),
        this.ariClient.getChannelVariable(runtimeCall.externalChannelId, 'UNICASTRTP_LOCAL_PORT'),
      ]);

      if (remoteAddress && remotePort) {
        const parsedPort = Number.parseInt(remotePort, 10);
        if (Number.isFinite(parsedPort) && parsedPort > 0) {
          transport.setRemoteTarget(remoteAddress, parsedPort);
        }
      }

      if (direction === 'inbound' && event.channel?.state !== 'Up') {
        try {
          await this.ariClient.answerChannel(channelId);
        } catch (error) {
          if (!isIgnorableAnswerError(error)) {
            throw error;
          }
        }
      }

      await this.ariClient.addChannelsToBridge(runtimeCall.bridgeId, [channelId]);

      await this.handlers.onCallReady({
        providerCallId: channelId,
        phone,
        direction,
        orgId: preflight.orgId,
        routeKey,
        transport,
      });
      releaseReservation();
    } catch (error) {
      releaseReservation();
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error(`[Asterisk ARI] Failed to initialize live bridge for ${channelId}:`, error);
      await this.cleanupCall(channelId, 'Failed to initialize live bridge', { hangupPrimaryChannel: true });
    }
  }

  private async cleanupCall(
    channelId: string,
    reason: string,
    options?: {
      hangupPrimaryChannel?: boolean;
    },
  ): Promise<void> {
    const runtimeCall = this.calls.get(channelId);
    if (!runtimeCall || runtimeCall.closing) {
      return;
    }

    runtimeCall.closing = true;

    runtimeCall.transport.clearAudio();
    runtimeCall.transport.close();

    await Promise.allSettled([
      this.ariClient.hangupChannel(runtimeCall.externalChannelId),
      this.ariClient.destroyBridge(runtimeCall.bridgeId),
      options?.hangupPrimaryChannel
        ? this.ariClient.hangupChannel(runtimeCall.channelId)
        : Promise.resolve(),
    ]);

    this.calls.delete(channelId);
    await this.handlers.onCallEnded({
      providerCallId: channelId,
      reason,
    });
  }
}

export { parseAppArgs };
