export type TelephonyProviderName = 'twilio' | 'plivo' | 'asterisk';

export interface TelephonyCallInfo {
  sid?: string;
  from?: string | null;
  to?: string | null;
  status?: string | null;
}

export interface TelephonyWebhookResult {
  type: 'inbound_started' | 'call_answered' | 'call_hangup' | 'tts_finished' | 'ignored';
  callControlId?: string;
  phone?: string;
}

export interface TelephonyOutboundCallResult {
  callControlId: string;
}

export interface TelephonyCallContext {
  providerCallId: string;
  direction: 'inbound' | 'outbound';
  phone: string;
}

export interface TelephonyInboundResponse {
  body: string;
  contentType: string;
  statusCode?: number;
}

export interface TelephonyInboundResponseParams {
  sessionId: string;
  providerCallId: string;
  phone?: string;
  useLiveStream?: boolean;
  streamToken?: string;
}

export interface TelephonyStatusDetail {
  label: string;
  value: string | null;
}

export interface TelephonyProviderStatus {
  provider: TelephonyProviderName;
  label: string;
  configured: boolean;
  ready: boolean;
  health: 'ready' | 'configuration_required' | 'foundation_only';
  controlMode: 'webhook' | 'ari';
  liveMediaReady: boolean;
  entryPoint: string | null;
  message: string;
  webhookPath: string;
  statusPath: string;
  streamWebSocketPath: string;
  webhookUrl: string;
  statusCallbackUrl: string;
  mediaStreamUrl: string;
  details: TelephonyStatusDetail[];
  notes: string[];
}

export interface TelephonyProviderSummary {
  key: TelephonyProviderName;
  name: string;
  configured: boolean;
  ready: boolean;
  active: boolean;
  message: string;
}

export interface TelephonyProviderAdapter {
  getProvider(): TelephonyProviderName;
  getStatus(): TelephonyProviderStatus;
  getWebhookUrl(): string;
  getStatusCallbackUrl(): string;
  getMediaStreamUrl(): string;
  getStatusPath(): string;
  getAnswerPath(): string;
  getStreamWebSocketPath(): string;
  verifyWebhookSignature(
    params: Record<string, string>,
    signature: string | null,
    kind?: 'voice' | 'status',
    options?: { nonce?: string | null },
  ): boolean;
  extractCallContext(event: Record<string, string>): TelephonyCallContext;
  makeCall(to: string, options?: { orgId?: string }): Promise<TelephonyOutboundCallResult>;
  getCallInfo(callControlId: string): Promise<TelephonyCallInfo | null>;
  handleWebhook(event: Record<string, string>): Promise<TelephonyWebhookResult>;
  hangupCall(callControlId: string): Promise<void>;
  transferCall(callControlId: string, to: string): Promise<void>;
  buildInboundResponse(params: TelephonyInboundResponseParams): TelephonyInboundResponse;
  buildStreamMediaMessage(streamId: string, mulawBase64: string): string;
  buildClearAudioMessage(streamId: string): string;
}
