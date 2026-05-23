import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../../config';
import { redactPhone } from '../../safe-log';
import { escapeXml } from '../shared';
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

interface PlivoCallCreateResponse {
  request_uuid?: string;
}

interface PlivoCallInfoResponse {
  call_uuid?: string;
  from_number?: string | null;
  to_number?: string | null;
  call_status?: string | null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function buildPlivoV3BaseString(url: string, params: Record<string, string>, nonce: string): string {
  const normalizedUrl = new URL(url);
  normalizedUrl.hash = '';

  const queryPairs = Array.from(normalizedUrl.searchParams.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => left.key === right.key
      ? left.value.localeCompare(right.value)
      : left.key.localeCompare(right.key));
  const queryString = queryPairs.map(({ key, value }) => `${key}=${value}`).join('&');

  normalizedUrl.search = '';
  const baseUrl = normalizedUrl.toString();
  const sortedPostParams = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');

  if (sortedPostParams) {
    const paramsSeparator = queryString ? `?${queryString}.` : '?';
    return `${baseUrl}${paramsSeparator}${sortedPostParams}.${nonce}`;
  }

  const queryPart = queryString ? `?${queryString}` : '';
  return `${baseUrl}${queryPart}.${nonce}`;
}

export function createPlivoV3Signature(params: {
  authToken: string;
  url: string;
  formParams: Record<string, string>;
  nonce: string;
}): string {
  return createHmac('sha256', params.authToken)
    .update(buildPlivoV3BaseString(params.url, params.formParams, params.nonce))
    .digest('base64');
}

export function verifyPlivoV3Signature(params: {
  authToken: string;
  url: string;
  formParams: Record<string, string>;
  nonce: string | null | undefined;
  signature: string | null | undefined;
}): boolean {
  if (!params.authToken || !params.url || !params.nonce || !params.signature) {
    return false;
  }

  const expected = createPlivoV3Signature({
    authToken: params.authToken,
    url: params.url,
    formParams: params.formParams,
    nonce: params.nonce,
  });
  return params.signature
    .split(',')
    .some((candidate) => safeEqual(candidate.trim(), expected));
}

export class PlivoTelephonyAdapter implements TelephonyProviderAdapter {
  private readonly authId = config.plivo.authId;
  private readonly authToken = config.plivo.authToken;
  private readonly phoneNumber = config.plivo.phoneNumber;

  getProvider(): 'plivo' {
    return 'plivo';
  }

  getStatus(): TelephonyProviderStatus {
    const webhookUrl = this.getWebhookUrl();
    const statusCallbackUrl = this.getStatusCallbackUrl();
    const mediaStreamUrl = this.getMediaStreamUrl();
    const configured = Boolean(this.authId && this.authToken && this.phoneNumber);
    const ready = configured && Boolean(webhookUrl);

    let message = 'Plivo credentials missing. The legacy adapter will stay in simulated mode.';
    if (configured && !webhookUrl) {
      message = 'Plivo credentials are present. Set PLIVO_PUBLIC_BASE_URL or TELEPHONY_PUBLIC_BASE_URL for live callbacks.';
    } else if (ready) {
      message = 'Plivo legacy adapter is ready.';
    }

    return {
      provider: 'plivo',
      label: 'Plivo',
      configured,
      ready,
      health: ready ? 'ready' : 'configuration_required',
      controlMode: 'webhook',
      liveMediaReady: Boolean(mediaStreamUrl),
      entryPoint: this.phoneNumber || null,
      message,
      webhookPath: config.plivo.answerPath,
      statusPath: config.plivo.statusPath,
      streamWebSocketPath: '/plivo-stream',
      webhookUrl,
      statusCallbackUrl,
      mediaStreamUrl,
      details: [
        { label: 'Phone number', value: this.phoneNumber || null },
        { label: 'Public base URL', value: config.plivo.publicBaseUrl || null },
        { label: 'Answer URL', value: webhookUrl || null },
        { label: 'Status callback URL', value: statusCallbackUrl || null },
        { label: 'Media stream URL', value: mediaStreamUrl || null },
      ],
      notes: [
        config.plivo.validateSignature
          ? 'Plivo V3 signature validation is enabled.'
          : 'Plivo signature validation is disabled.',
      ],
    };
  }

  getWebhookUrl(): string {
    if (!config.plivo.publicBaseUrl) {
      return '';
    }
    return `${config.plivo.publicBaseUrl}${config.plivo.answerPath}`;
  }

  getStatusCallbackUrl(): string {
    if (!config.plivo.publicBaseUrl) {
      return '';
    }
    return `${config.plivo.publicBaseUrl}${config.plivo.statusPath}`;
  }

  getMediaStreamUrl(): string {
    if (config.plivo.mediaStreamUrl) {
      return config.plivo.mediaStreamUrl;
    }
    if (!config.plivo.publicBaseUrl) {
      return '';
    }
    return `${config.plivo.publicBaseUrl}/plivo-stream`;
  }

  getStatusPath(): string {
    return config.plivo.statusPath;
  }

  getAnswerPath(): string {
    return config.plivo.answerPath;
  }

  getStreamWebSocketPath(): string {
    return '/plivo-stream';
  }

  verifyWebhookSignature(
    params: Record<string, string>,
    signature: string | null,
    kind: 'voice' | 'status' = 'voice',
    options?: { nonce?: string | null },
  ): boolean {
    if (!config.plivo.validateSignature) {
      return true;
    }

    const webhookUrl = kind === 'status' ? this.getStatusCallbackUrl() : this.getWebhookUrl();
    const isValid = verifyPlivoV3Signature({
      authToken: this.authToken,
      url: webhookUrl,
      formParams: params,
      nonce: options?.nonce,
      signature,
    });
    if (!isValid) {
      console.warn('[Telephony] Plivo V3 signature verification failed');
    }
    return isValid;
  }

  extractCallContext(event: Record<string, string>): TelephonyCallContext {
    const direction = event.Direction === 'outbound-api' || event.Direction === 'outbound-dial' || event.Direction === 'outbound'
      ? 'outbound'
      : 'inbound';
    const phone = direction === 'outbound'
      ? (event.To || event.ToNumber || event.From || 'unknown')
      : (event.From || event.FromNumber || 'unknown');

    return {
      providerCallId: event.CallUUID || event.CallUUIDs || event.RequestUUID || `plivo-call-${Date.now()}`,
      direction,
      phone,
    };
  }

  private async fetchPlivo(path: string, init?: RequestInit): Promise<Response> {
    if (!this.authId || !this.authToken) {
      throw new Error('PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN must be configured');
    }

    const response = await fetch(`https://api.plivo.com/v1/Account/${this.authId}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.authId}:${this.authToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Plivo API error ${response.status}: ${body || response.statusText}`);
    }

    return response;
  }

  async makeCall(to: string): Promise<TelephonyOutboundCallResult> {
    if (!this.authId || !this.authToken || !this.phoneNumber) {
      console.log(`[Telephony] Simulated Plivo outbound call to ${redactPhone(to)}`);
      return { callControlId: `simulated-${Date.now()}` };
    }

    const answerUrl = this.getWebhookUrl();
    const statusCallbackUrl = this.getStatusCallbackUrl();
    if (!answerUrl) {
      throw new Error('PLIVO_PUBLIC_BASE_URL must be configured for live outbound calls');
    }

    const response = await this.fetchPlivo('/Call/', {
      method: 'POST',
      body: JSON.stringify({
        from: this.phoneNumber,
        to,
        answer_url: answerUrl,
        answer_method: 'POST',
        hangup_url: statusCallbackUrl || undefined,
        hangup_method: 'POST',
        ring_url: statusCallbackUrl || undefined,
        ring_method: 'POST',
      }),
    });
    const payload = await response.json() as PlivoCallCreateResponse;
    const requestUuid = payload.request_uuid;
    if (!requestUuid) {
      throw new Error('Plivo response missing request_uuid');
    }

    console.log(`[Telephony] Plivo outbound call initiated: ${requestUuid} -> ${redactPhone(to)}`);
    return { callControlId: requestUuid };
  }

  async getCallInfo(callControlId: string): Promise<TelephonyCallInfo | null> {
    if (!callControlId || callControlId.startsWith('simulated-') || !this.authId || !this.authToken) {
      return null;
    }

    try {
      const response = await this.fetchPlivo(`/Call/${callControlId}/`, { method: 'GET' });
      const call = await response.json() as PlivoCallInfoResponse;
      return {
        sid: call.call_uuid,
        from: call.from_number,
        to: call.to_number,
        status: call.call_status,
      };
    } catch (error) {
      console.warn(`[Telephony] Unable to fetch Plivo call info for ${callControlId}:`, error);
      return null;
    }
  }

  async handleWebhook(event: Record<string, string>): Promise<TelephonyWebhookResult> {
    const callUuid = event.CallUUID || event.CallUUIDs || event.RequestUUID;
    const from = event.From || event.FromNumber;
    const callStatus = (event.CallStatus || event.Event || event.RequestType || '').toLowerCase();
    const direction = (event.Direction || '').toLowerCase();
    const phone = direction === 'outbound' ? (event.To || event.ToNumber || from) : from;

    if (callStatus.includes('ring')) {
      if (direction === 'inbound') {
        return { type: 'inbound_started', callControlId: callUuid, phone };
      }
      return { type: 'ignored', callControlId: callUuid, phone };
    }

    if (
      callStatus.includes('answer') ||
      callStatus.includes('in-progress') ||
      callStatus.includes('active')
    ) {
      return { type: 'call_answered', callControlId: callUuid, phone };
    }

    if (
      callStatus.includes('hangup') ||
      callStatus.includes('completed') ||
      callStatus.includes('failed') ||
      callStatus.includes('busy') ||
      callStatus.includes('no-answer') ||
      callStatus.includes('cancel')
    ) {
      return { type: 'call_hangup', callControlId: callUuid, phone };
    }

    return { type: 'ignored', callControlId: callUuid, phone };
  }

  async hangupCall(callControlId: string): Promise<void> {
    if (callControlId.startsWith('simulated-')) {
      console.log(`[Telephony] Simulated Plivo hangup ${callControlId}`);
      return;
    }

    if (!this.authId || !this.authToken) {
      console.log(`[Telephony] Simulated Plivo hangup ${callControlId}`);
      return;
    }

    try {
      await this.fetchPlivo(`/Call/${callControlId}/`, { method: 'DELETE' });
      console.log(`[Telephony] Plivo call hung up: ${callControlId}`);
    } catch (err) {
      console.error(`[Telephony] Failed to hang up Plivo call ${callControlId}:`, err);
    }
  }

  async transferCall(callControlId: string, to: string): Promise<void> {
    console.log(`[Telephony] Transfer requested ${callControlId} -> ${redactPhone(to)} (Plivo transfer not implemented yet)`);
  }

  buildInboundResponse(params: TelephonyInboundResponseParams): TelephonyInboundResponse {
    const streamUrl = this.getMediaStreamUrl();
    if (params.useLiveStream && streamUrl) {
      return {
        contentType: 'text/xml',
        body: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<Response>',
          params.streamToken
            ? `  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000" extraHeaders="streamToken=${escapeXml(params.streamToken)};sessionId=${escapeXml(params.sessionId)};callId=${escapeXml(params.providerCallId)}${params.phone ? `;phone=${escapeXml(params.phone)}` : ''}">`
            : '  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">',
          `    ${escapeXml(streamUrl)}`,
          '  </Stream>',
          '</Response>',
        ].join('\n'),
      };
    }

    return {
      contentType: 'text/xml',
      body: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Response>',
        `  <Speak language="en-US">Hello. Thank you for calling ${escapeXml(config.business.name)}. Our live voice assistant is currently unavailable. Please call back shortly or contact the front desk directly.</Speak>`,
        '</Response>',
      ].join('\n'),
    };
  }

  buildStreamMediaMessage(streamId: string, mulawBase64: string): string {
    return JSON.stringify({
      event: 'playAudio',
      media: {
        contentType: 'audio/x-mulaw',
        sampleRate: 8000,
        payload: mulawBase64,
      },
    });
  }

  buildClearAudioMessage(streamId: string): string {
    return JSON.stringify({
      event: 'clearAudio',
      streamId,
    });
  }
}
