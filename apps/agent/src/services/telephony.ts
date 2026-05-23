import { config } from '../config';
import { AsteriskTelephonyAdapter } from './telephony/providers/asterisk';
import { PlivoTelephonyAdapter } from './telephony/providers/plivo';
import { TwilioTelephonyAdapter } from './telephony/providers/twilio';
import type {
  TelephonyCallContext,
  TelephonyCallInfo,
  TelephonyInboundResponse,
  TelephonyInboundResponseParams,
  TelephonyOutboundCallResult,
  TelephonyProviderAdapter,
  TelephonyProviderName,
  TelephonyProviderStatus,
  TelephonyProviderSummary,
  TelephonyWebhookResult,
} from './telephony/types';

export type {
  TelephonyCallContext,
  TelephonyCallInfo,
  TelephonyInboundResponse,
  TelephonyInboundResponseParams,
  TelephonyOutboundCallResult,
  TelephonyProviderName,
  TelephonyProviderStatus,
  TelephonyProviderSummary,
  TelephonyWebhookResult,
} from './telephony/types';

function createTelephonyProvider(): TelephonyProviderAdapter {
  switch (config.telephony.provider) {
    case 'plivo':
      return new PlivoTelephonyAdapter();
    case 'asterisk':
      return new AsteriskTelephonyAdapter();
    case 'twilio':
    default:
      return new TwilioTelephonyAdapter();
  }
}

export class TelephonyService {
  constructor(private readonly adapter: TelephonyProviderAdapter = createTelephonyProvider()) {}

  getProvider(): TelephonyProviderName {
    return this.adapter.getProvider();
  }

  getStatus(): TelephonyProviderStatus {
    return this.adapter.getStatus();
  }

  getAvailableProviders(): TelephonyProviderSummary[] {
    const providers: TelephonyProviderAdapter[] = [
      new TwilioTelephonyAdapter(),
      new PlivoTelephonyAdapter(),
      new AsteriskTelephonyAdapter(),
    ];

    return providers.map((provider) => {
      const status = provider.getStatus();
      return {
        key: status.provider,
        name: status.label,
        configured: status.configured,
        ready: status.ready,
        active: status.provider === this.getProvider(),
        message: status.message,
      };
    });
  }

  getWebhookUrl(): string {
    return this.adapter.getWebhookUrl();
  }

  getStatusCallbackUrl(): string {
    return this.adapter.getStatusCallbackUrl();
  }

  getMediaStreamUrl(): string {
    return this.adapter.getMediaStreamUrl();
  }

  getStatusPath(): string {
    return this.adapter.getStatusPath();
  }

  getAnswerPath(): string {
    return this.adapter.getAnswerPath();
  }

  getStreamWebSocketPath(): string {
    return this.adapter.getStreamWebSocketPath();
  }

  verifyWebhookSignature(
    params: Record<string, string>,
    signature: string | null,
    kind?: 'voice' | 'status',
    options?: { nonce?: string | null },
  ): boolean {
    return this.adapter.verifyWebhookSignature(params, signature, kind, options);
  }

  extractCallContext(event: Record<string, string>): TelephonyCallContext {
    return this.adapter.extractCallContext(event);
  }

  async makeCall(to: string, options?: { orgId?: string }): Promise<TelephonyOutboundCallResult> {
    return this.adapter.makeCall(to, options);
  }

  async getCallInfo(callControlId: string): Promise<TelephonyCallInfo | null> {
    return this.adapter.getCallInfo(callControlId);
  }

  async handleWebhook(event: Record<string, string>): Promise<TelephonyWebhookResult> {
    return this.adapter.handleWebhook(event);
  }

  async hangupCall(callControlId: string): Promise<void> {
    return this.adapter.hangupCall(callControlId);
  }

  async transferCall(callControlId: string, to: string): Promise<void> {
    return this.adapter.transferCall(callControlId, to);
  }

  buildInboundResponse(params: TelephonyInboundResponseParams): TelephonyInboundResponse {
    return this.adapter.buildInboundResponse(params);
  }

  buildStreamMediaMessage(streamId: string, mulawBase64: string): string {
    return this.adapter.buildStreamMediaMessage(streamId, mulawBase64);
  }

  buildClearAudioMessage(streamId: string): string {
    return this.adapter.buildClearAudioMessage(streamId);
  }
}
