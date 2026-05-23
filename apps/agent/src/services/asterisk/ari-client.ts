import { WebSocket } from 'ws';
import { config } from '../../config';

interface AriVariableResponse {
  value?: string;
}

export interface AriChannel {
  id?: string;
  name?: string;
  state?: string | null;
  caller?: {
    number?: string | null;
  };
  connected?: {
    number?: string | null;
  };
}

export interface AriBridge {
  id?: string;
  name?: string;
}

export interface AriEvent {
  type?: string;
  application?: string;
  args?: string[];
  channel?: AriChannel;
  bridge?: AriBridge;
}

interface AriEventStreamOptions {
  app: string;
  onOpen?: () => void;
  onEvent: (event: AriEvent) => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (error: Error) => void;
}

interface CreateBridgeOptions {
  bridgeId: string;
  name?: string;
  type?: string;
}

interface CreateExternalMediaOptions {
  app: string;
  channelId: string;
  externalHost: string;
  format?: string;
  variables?: Record<string, string>;
}

interface OriginateChannelOptions {
  app: string;
  appArgs?: string;
  callerId: string;
  channelId: string;
  endpoint: string;
  timeoutSeconds?: number;
}

function buildAriEventsWebSocketUrl(baseUrl: string, app: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/events`;
  url.searchParams.set('app', app);
  return url.toString();
}

export class AsteriskAriClient {
  constructor(
    private readonly baseUrl = config.asterisk.ariBaseUrl,
    private readonly username = config.asterisk.ariUsername,
    private readonly password = config.asterisk.ariPassword,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.username && this.password);
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error('Asterisk ARI is not configured. Set ASTERISK_ARI_BASE_URL, ASTERISK_ARI_USERNAME, and ASTERISK_ARI_PASSWORD.');
    }
  }

  private getAuthorizationHeader(): string {
    return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
  }

  private async request(
    path: string,
    init?: RequestInit,
    allowedStatuses: number[] = [200, 204],
  ): Promise<Response> {
    this.ensureConfigured();

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.getAuthorizationHeader(),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
    });

    if (!allowedStatuses.includes(response.status)) {
      const body = await response.text().catch(() => '');
      throw new Error(`Asterisk ARI error ${response.status}: ${body || response.statusText}`);
    }

    return response;
  }

  connectEvents(options: AriEventStreamOptions): WebSocket {
    this.ensureConfigured();

    const ws = new WebSocket(buildAriEventsWebSocketUrl(this.baseUrl, options.app), {
      headers: {
        Authorization: this.getAuthorizationHeader(),
      },
    });

    ws.on('open', () => {
      options.onOpen?.();
    });

    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as AriEvent;
        options.onEvent(event);
      } catch (error) {
        options.onError?.(
          error instanceof Error
            ? error
            : new Error('Unknown ARI websocket message parse error'),
        );
      }
    });

    ws.on('close', (code, reason) => {
      options.onClose?.(code, reason.toString());
    });

    ws.on('error', (error) => {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    });

    return ws;
  }

  async answerChannel(channelId: string): Promise<void> {
    await this.request(`/channels/${encodeURIComponent(channelId)}/answer`, { method: 'POST' });
  }

  async addChannelsToBridge(bridgeId: string, channelIds: string[]): Promise<void> {
    await this.request(
      `/bridges/${encodeURIComponent(bridgeId)}/addChannel?channel=${encodeURIComponent(channelIds.join(','))}`,
      { method: 'POST' },
    );
  }

  async createBridge(options: CreateBridgeOptions): Promise<void> {
    await this.request(
      `/bridges/${encodeURIComponent(options.bridgeId)}?type=${encodeURIComponent(
        options.type || 'mixing,proxy_media,dtmf_events',
      )}&name=${encodeURIComponent(options.name || options.bridgeId)}`,
      { method: 'POST' },
      [200, 204, 409],
    );
  }

  async createExternalMediaChannel(options: CreateExternalMediaOptions): Promise<AriChannel> {
    const response = await this.request(
      `/channels/externalMedia?app=${encodeURIComponent(options.app)}&channelId=${encodeURIComponent(
        options.channelId,
      )}&external_host=${encodeURIComponent(options.externalHost)}&format=${encodeURIComponent(
        options.format || 'ulaw',
      )}`,
      {
        method: 'POST',
        body: JSON.stringify({
          variables: options.variables || {},
        }),
      },
    );

    return response.json() as Promise<AriChannel>;
  }

  async destroyBridge(bridgeId: string): Promise<void> {
    await this.request(`/bridges/${encodeURIComponent(bridgeId)}`, { method: 'DELETE' }, [204, 404]);
  }

  async getCallInfo(channelId: string): Promise<AriChannel | null> {
    const response = await this.request(`/channels/${encodeURIComponent(channelId)}`, { method: 'GET' }, [200, 404]);
    if (response.status === 404) {
      return null;
    }
    return response.json() as Promise<AriChannel>;
  }

  async getChannelVariable(channelId: string, variable: string): Promise<string | null> {
    const response = await this.request(
      `/channels/${encodeURIComponent(channelId)}/variable?variable=${encodeURIComponent(variable)}`,
      { method: 'GET' },
      [200, 404],
    );

    if (response.status === 404) {
      return null;
    }

    const payload = await response.json() as AriVariableResponse;
    return payload.value ?? null;
  }

  async hangupChannel(channelId: string): Promise<void> {
    await this.request(`/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' }, [204, 404]);
  }

  async originateChannel(options: OriginateChannelOptions): Promise<AriChannel> {
    const timeout = options.timeoutSeconds ?? 30;
    const response = await this.request(
      `/channels/${encodeURIComponent(options.channelId)}?endpoint=${encodeURIComponent(
        options.endpoint,
      )}&app=${encodeURIComponent(options.app)}&callerId=${encodeURIComponent(
        options.callerId,
      )}&timeout=${encodeURIComponent(String(timeout))}${options.appArgs
        ? `&appArgs=${encodeURIComponent(options.appArgs)}`
        : ''}`,
      { method: 'POST' },
    );

    return response.json() as Promise<AriChannel>;
  }

  async redirectChannel(channelId: string, endpoint: string): Promise<void> {
    await this.request(
      `/channels/${encodeURIComponent(channelId)}/redirect?endpoint=${encodeURIComponent(endpoint)}`,
      { method: 'POST' },
    );
  }
}

export { buildAriEventsWebSocketUrl };
