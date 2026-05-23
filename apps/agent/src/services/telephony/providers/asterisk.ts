import { config } from '../../../config';
import { AsteriskAriClient } from '../../asterisk/ari-client';
import type {
  TelephonyCallContext,
  TelephonyCallInfo,
  TelephonyInboundResponse,
  TelephonyInboundResponseParams,
  TelephonyOutboundCallResult,
  TelephonyProviderAdapter,
  TelephonyProviderStatus,
  TelephonyWebhookResult,
} from '../types';

export class AsteriskTelephonyAdapter implements TelephonyProviderAdapter {
  private readonly ariClient = new AsteriskAriClient();

  private hasExternalMediaTarget(): boolean {
    return Boolean(config.asterisk.externalMediaHost);
  }

  private buildOutboundEndpoint(to: string): string {
    const template = config.asterisk.outboundEndpointTemplate || 'PJSIP/{to}@{endpoint}';
    return template
      .replaceAll('{to}', to)
      .replaceAll('{endpoint}', config.asterisk.pjsipEndpoint)
      .replaceAll('{sipDomain}', config.asterisk.sipDomain || config.asterisk.publicHost || '');
  }

  getProvider(): 'asterisk' {
    return 'asterisk';
  }

  getStatus(): TelephonyProviderStatus {
    const configured = this.ariClient.isConfigured();
    const liveMediaConfigured = configured && this.hasExternalMediaTarget();
    const entryPoint = this.getEntryPoint();

    return {
      provider: 'asterisk',
      label: 'Asterisk',
      configured,
      ready: liveMediaConfigured,
      health: liveMediaConfigured ? 'ready' : configured ? 'foundation_only' : 'configuration_required',
      controlMode: 'ari',
      liveMediaReady: liveMediaConfigured,
      entryPoint,
      message: !configured
        ? 'Asterisk is selected, but ARI credentials are missing. Set ASTERISK_ARI_BASE_URL, ASTERISK_ARI_USERNAME, and ASTERISK_ARI_PASSWORD.'
        : !this.hasExternalMediaTarget()
          ? 'Asterisk ARI control is configured. Set ASTERISK_EXTERNAL_MEDIA_HOST so Asterisk can send RTP to the agent runtime.'
          : 'Asterisk ARI control and external media are configured. The active websocket connection is verified at runtime via /health.',
      webhookPath: config.asterisk.eventPath,
      statusPath: config.asterisk.statusPath,
      streamWebSocketPath: config.asterisk.mediaWsPath,
      webhookUrl: this.getWebhookUrl(),
      statusCallbackUrl: this.getStatusCallbackUrl(),
      mediaStreamUrl: '',
      details: [
        { label: 'ARI base URL', value: config.asterisk.ariBaseUrl || null },
        { label: 'ARI application', value: config.asterisk.ariApplication || null },
        { label: 'SIP entry point', value: entryPoint },
        { label: 'PJSIP endpoint', value: config.asterisk.pjsipEndpoint || null },
        { label: 'Inbound context', value: config.asterisk.inboundContext || null },
        { label: 'Outbound context', value: config.asterisk.outboundContext || null },
        { label: 'External media host', value: config.asterisk.externalMediaHost || null },
        { label: 'External media bind address', value: config.asterisk.externalMediaBindAddress || null },
        {
          label: 'External media port',
          value: config.asterisk.externalMediaPort > 0 ? String(config.asterisk.externalMediaPort) : 'dynamic',
        },
        { label: 'Outbound endpoint template', value: config.asterisk.outboundEndpointTemplate || null },
      ],
      notes: [
        'Route customer traffic through a SIP trunk, PBX route, forwarding rule, or gateway.',
        'The live bridge uses ARI externalMedia over RTP/UDP with ulaw at 8 kHz.',
        'Clearing output can only drop unsent local RTP frames. Audio already sent to Asterisk cannot be recalled.',
        'If ASTERISK_EXTERNAL_MEDIA_PORT is fixed to a single port, only one live call can bind it at a time.',
      ],
    };
  }

  private getEntryPoint(): string | null {
    const host = config.asterisk.sipDomain || config.asterisk.publicHost;
    if (host) {
      return `sip:${config.asterisk.pjsipEndpoint}@${host}`;
    }
    if (config.asterisk.pjsipEndpoint) {
      return `PJSIP/${config.asterisk.pjsipEndpoint}`;
    }
    return null;
  }

  getWebhookUrl(): string {
    if (!config.telephony.publicBaseUrl) {
      return '';
    }
    return `${config.telephony.publicBaseUrl}${config.asterisk.eventPath}`;
  }

  getStatusCallbackUrl(): string {
    if (!config.telephony.publicBaseUrl) {
      return '';
    }
    return `${config.telephony.publicBaseUrl}${config.asterisk.statusPath}`;
  }

  getMediaStreamUrl(): string {
    return '';
  }

  getStatusPath(): string {
    return config.asterisk.statusPath;
  }

  getAnswerPath(): string {
    return config.asterisk.eventPath;
  }

  getStreamWebSocketPath(): string {
    return config.asterisk.mediaWsPath;
  }

  verifyWebhookSignature(): boolean {
    return true;
  }

  extractCallContext(event: Record<string, string>): TelephonyCallContext {
    const directionRaw = (
      event.direction ||
      event.Direction ||
      event.channel_direction ||
      event.ChannelDirection ||
      ''
    ).toLowerCase();
    const direction = directionRaw.includes('outbound') ? 'outbound' : 'inbound';
    const phone = direction === 'outbound'
      ? (event.dialed_number || event.To || event.Exten || event.endpoint || 'unknown')
      : (event.caller_number || event.CallerIDNum || event.From || event.CallerID || 'unknown');

    return {
      providerCallId:
        event.channel_id ||
        event.ChannelId ||
        event.Uniqueid ||
        event.call_id ||
        `asterisk-call-${Date.now()}`,
      direction,
      phone,
    };
  }

  async makeCall(to: string, options?: { orgId?: string }): Promise<TelephonyOutboundCallResult> {
    const channelId = `asterisk-out-${Date.now()}`;
    const endpoint = this.buildOutboundEndpoint(to);
    const callerId = config.business.receptionNumber || config.agent.name;

    await this.ariClient.originateChannel({
      app: config.asterisk.ariApplication,
      appArgs: [
        'direction=outbound',
        `dialed_number=${to}`,
        options?.orgId ? `org_id=${options.orgId}` : null,
      ].filter(Boolean).join(','),
      callerId,
      channelId,
      endpoint,
    });

    return { callControlId: channelId };
  }

  async getCallInfo(callControlId: string): Promise<TelephonyCallInfo | null> {
    if (!callControlId || !this.ariClient.isConfigured()) {
      return null;
    }

    try {
      const channel = await this.ariClient.getCallInfo(callControlId);
      if (!channel) {
        return null;
      }

      return {
        sid: channel.id,
        from: channel.caller?.number ?? null,
        to: channel.connected?.number ?? null,
        status: channel.state ?? null,
      };
    } catch (error) {
      console.warn(`[Telephony] Unable to fetch Asterisk call info for ${callControlId}:`, error);
      return null;
    }
  }

  async handleWebhook(event: Record<string, string>): Promise<TelephonyWebhookResult> {
    const context = this.extractCallContext(event);
    const eventType = (
      event.type ||
      event.Event ||
      event.asterisk_event ||
      event.AriEvent ||
      ''
    ).toLowerCase();
    const state = (event.channel_state || event.ChannelState || '').toLowerCase();

    if (
      eventType.includes('stasisstart') ||
      eventType.includes('channelcreated') ||
      eventType.includes('dialbegin')
    ) {
      return { type: 'inbound_started', callControlId: context.providerCallId, phone: context.phone };
    }

    if (
      eventType.includes('answered') ||
      eventType.includes('channelanswered') ||
      (eventType.includes('channelstatechange') && state === 'up')
    ) {
      return { type: 'call_answered', callControlId: context.providerCallId, phone: context.phone };
    }

    if (
      eventType.includes('stasisend') ||
      eventType.includes('hangup') ||
      eventType.includes('channeldestroyed')
    ) {
      return { type: 'call_hangup', callControlId: context.providerCallId, phone: context.phone };
    }

    return { type: 'ignored', callControlId: context.providerCallId, phone: context.phone };
  }

  async hangupCall(callControlId: string): Promise<void> {
    await this.ariClient.hangupChannel(callControlId);
  }

  async transferCall(callControlId: string, to: string): Promise<void> {
    const endpoint = this.buildOutboundEndpoint(to);
    await this.ariClient.redirectChannel(callControlId, endpoint);
  }

  buildInboundResponse(_params: TelephonyInboundResponseParams): TelephonyInboundResponse {
    return {
      statusCode: 405,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        provider: 'asterisk',
        message: 'Inbound Asterisk calls enter through the ARI websocket runtime. This HTTP path is not used by the live bridge.',
      }),
    };
  }

  buildStreamMediaMessage(_streamId: string, _mulawBase64: string): string {
    throw new Error('Asterisk RTP external media does not use websocket stream messages.');
  }

  buildClearAudioMessage(_streamId: string): string {
    throw new Error('Asterisk RTP external media does not use websocket stream messages.');
  }
}
