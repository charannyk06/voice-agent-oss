import twilio from 'twilio';
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

interface TwilioCallSidResponse {
  sid?: string;
}

export class TwilioTelephonyAdapter implements TelephonyProviderAdapter {
  private readonly accountSid = config.twilio.accountSid;
  private readonly authToken = config.twilio.authToken;
  private readonly phoneNumber = config.twilio.phoneNumber;
  private readonly client = this.accountSid && this.authToken
    ? twilio(this.accountSid, this.authToken)
    : null;

  getProvider(): 'twilio' {
    return 'twilio';
  }

  getStatus(): TelephonyProviderStatus {
    const webhookUrl = this.getWebhookUrl();
    const statusCallbackUrl = this.getStatusCallbackUrl();
    const mediaStreamUrl = this.getMediaStreamUrl();
    const configured = Boolean(this.accountSid && this.authToken && this.phoneNumber);
    const ready = configured && Boolean(webhookUrl);

    let message = 'Twilio credentials missing. The legacy adapter will stay in simulated mode.';
    if (configured && !webhookUrl) {
      message = 'Twilio credentials are present. Set TWILIO_PUBLIC_BASE_URL or TELEPHONY_PUBLIC_BASE_URL for live callbacks.';
    } else if (ready) {
      message = 'Twilio legacy adapter is ready.';
    }

    return {
      provider: 'twilio',
      label: 'Twilio',
      configured,
      ready,
      health: ready ? 'ready' : 'configuration_required',
      controlMode: 'webhook',
      liveMediaReady: Boolean(mediaStreamUrl),
      entryPoint: this.phoneNumber || null,
      message,
      webhookPath: config.twilio.webhookPath,
      statusPath: `${config.twilio.webhookPath}/status`,
      streamWebSocketPath: '/twilio-stream',
      webhookUrl,
      statusCallbackUrl,
      mediaStreamUrl,
      details: [
        { label: 'Phone number', value: this.phoneNumber || null },
        { label: 'Public base URL', value: config.twilio.publicBaseUrl || null },
        { label: 'Webhook URL', value: webhookUrl || null },
        { label: 'Status callback URL', value: statusCallbackUrl || null },
        { label: 'Media stream URL', value: mediaStreamUrl || null },
      ],
      notes: [
        config.twilio.validateSignature
          ? 'Twilio signature validation is enabled.'
          : 'Twilio signature validation is disabled.',
      ],
    };
  }

  getWebhookUrl(): string {
    if (!config.twilio.publicBaseUrl) {
      return '';
    }
    return `${config.twilio.publicBaseUrl}${config.twilio.webhookPath}`;
  }

  getStatusCallbackUrl(): string {
    if (!config.twilio.publicBaseUrl) {
      return '';
    }
    return `${config.twilio.publicBaseUrl}${config.twilio.webhookPath}/status`;
  }

  getMediaStreamUrl(): string {
    if (config.twilio.mediaStreamUrl) {
      return config.twilio.mediaStreamUrl;
    }
    if (!config.twilio.publicBaseUrl) {
      return '';
    }
    return `${config.twilio.publicBaseUrl}/twilio-stream`;
  }

  getStatusPath(): string {
    return `${config.twilio.webhookPath}/status`;
  }

  getAnswerPath(): string {
    return config.twilio.webhookPath;
  }

  getStreamWebSocketPath(): string {
    return '/twilio-stream';
  }

  verifyWebhookSignature(params: Record<string, string>, signature: string | null, kind: 'voice' | 'status' = 'voice'): boolean {
    if (!config.twilio.validateSignature) {
      return true;
    }

    if (!this.authToken || !signature) {
      console.warn('[Telephony] Missing Twilio auth token or signature, rejecting webhook');
      return false;
    }

    const webhookUrl = kind === 'status' ? this.getStatusCallbackUrl() : this.getWebhookUrl();
    if (!webhookUrl) {
      console.warn('[Telephony] TWILIO_PUBLIC_BASE_URL not configured, rejecting webhook');
      return false;
    }

    const isValid = twilio.validateRequest(this.authToken, signature, webhookUrl, params);
    if (!isValid) {
      console.warn('[Telephony] Twilio signature verification failed for', webhookUrl);
    }
    return isValid;
  }

  extractCallContext(event: Record<string, string>): TelephonyCallContext {
    const direction = event.Direction === 'outbound-api' || event.Direction === 'outbound-dial' || event.Direction === 'outbound'
      ? 'outbound'
      : 'inbound';
    const phone = direction === 'outbound'
      ? (event.To || event.to || 'unknown')
      : (event.From || event.from || 'unknown');

    return {
      providerCallId: event.CallSid || `twilio-call-${Date.now()}`,
      direction,
      phone,
    };
  }

  async makeCall(to: string): Promise<TelephonyOutboundCallResult> {
    if (!this.client || !this.phoneNumber) {
      console.log(`[Telephony] Simulated outbound call to ${redactPhone(to)}`);
      return { callControlId: `simulated-${Date.now()}` };
    }

    const webhookUrl = this.getWebhookUrl();
    const statusCallbackUrl = this.getStatusCallbackUrl();
    if (!webhookUrl) {
      throw new Error('TWILIO_PUBLIC_BASE_URL must be configured for live outbound calls');
    }

    const call = await this.client.calls.create({
      to,
      from: this.phoneNumber,
      url: webhookUrl,
      statusCallback: statusCallbackUrl || undefined,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
    }) as TwilioCallSidResponse;

    const callSid = call?.sid;
    if (!callSid) {
      throw new Error('Twilio response missing CallSid');
    }

    console.log(`[Telephony] Twilio outbound call initiated: ${callSid} -> ${redactPhone(to)}`);
    return { callControlId: callSid };
  }

  async getCallInfo(callControlId: string): Promise<TelephonyCallInfo | null> {
    if (!callControlId || callControlId.startsWith('simulated-') || !this.client) {
      return null;
    }

    try {
      const call = await this.client.calls(callControlId).fetch();
      return {
        sid: call.sid,
        from: call.from,
        to: call.to,
        status: call.status,
      };
    } catch (error) {
      console.warn(`[Telephony] Unable to fetch Twilio call info for ${callControlId}:`, error);
      return null;
    }
  }

  async handleWebhook(event: Record<string, string>): Promise<TelephonyWebhookResult> {
    const callSid = event.CallSid;
    const callStatus = event.CallStatus;
    const from = event.From;
    const to = event.To;
    const direction = event.Direction;

    // For outbound calls, the relevant phone is To (the destination).
    // For inbound calls, the relevant phone is From (the caller).
    const phone = direction === 'outbound-dial' || direction === 'outbound'
      ? (to || from || 'unknown')
      : (from || to || 'unknown');

    switch (callStatus) {
      case 'ringing':
        if (direction === 'inbound') {
          console.log(`[Telephony] Inbound call ringing: ${callSid} from ${redactPhone(from || '')}`);
          return { type: 'inbound_started', callControlId: callSid, phone: from };
        }
        return { type: 'ignored', callControlId: callSid, phone: from };

      case 'in-progress':
      case 'answered':
        console.log(`[Telephony] Call answered: ${callSid}`);
        return { type: 'call_answered', callControlId: callSid, phone: from };

      case 'completed':
      case 'busy':
      case 'no-answer':
      case 'failed':
      case 'canceled':
        console.log(`[Telephony] Call ended (${callStatus}): ${callSid}`);
        return { type: 'call_hangup', callControlId: callSid, phone: from };

      default: {
        const dialCallStatus = event.DialCallStatus;
        if (dialCallStatus) {
          console.log(`[Telephony] Dial status: ${dialCallStatus}`);
          return { type: 'call_hangup', callControlId: callSid, phone: from };
        }
        return { type: 'ignored', callControlId: callSid, phone: from };
      }
    }
  }

  async hangupCall(callControlId: string): Promise<void> {
    if (callControlId.startsWith('simulated-')) {
      console.log(`[Telephony] Simulated hangup ${callControlId}`);
      return;
    }

    if (!this.client) {
      console.log(`[Telephony] Simulated hangup ${callControlId}`);
      return;
    }

    try {
      await this.client.calls(callControlId).update({ status: 'completed' });
      console.log(`[Telephony] Twilio call hung up: ${callControlId}`);
    } catch (err) {
      console.error(`[Telephony] Failed to hang up Twilio call ${callControlId}:`, err);
    }
  }

  async transferCall(callControlId: string, to: string): Promise<void> {
    if (!this.client) {
      console.log(`[Telephony] Simulated transfer ${callControlId} -> ${redactPhone(to)}`);
      return;
    }

    console.log(`[Telephony] Transfer requested ${callControlId} -> ${redactPhone(to)} (Twilio transfer via conference or redirect)`);
  }

  buildInboundResponse(params: TelephonyInboundResponseParams): TelephonyInboundResponse {
    const streamUrl = this.getMediaStreamUrl();
    if (params.useLiveStream && streamUrl) {
      return {
        contentType: 'text/xml',
        body: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<Response>',
          '  <Connect>',
          `    <Stream url="${escapeXml(streamUrl)}">`,
          `      <Parameter name="sessionId" value="${escapeXml(params.sessionId)}"/>`,
          `      <Parameter name="callId" value="${escapeXml(params.providerCallId)}"/>`,
          params.streamToken ? `      <Parameter name="streamToken" value="${escapeXml(params.streamToken)}"/>` : '',
          params.phone ? `      <Parameter name="phone" value="${escapeXml(params.phone)}"/>` : '',
          '    </Stream>',
          '  </Connect>',
          '</Response>',
        ].filter(Boolean).join('\n'),
      };
    }

    return {
      contentType: 'text/xml',
      body: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Response>',
        '  <Say voice="Polly.Joanna" language="en-US">',
        `    Hello. Thank you for calling ${config.business.name}.`,
        '    Our live voice assistant is currently unavailable. Please call back shortly or contact the front desk directly.',
        '  </Say>',
        '</Response>',
      ].join('\n'),
    };
  }

  buildStreamMediaMessage(streamId: string, mulawBase64: string): string {
    return JSON.stringify({
      event: 'media',
      streamSid: streamId,
      media: { payload: mulawBase64 },
    });
  }

  buildClearAudioMessage(streamId: string): string {
    return JSON.stringify({ event: 'clear', streamSid: streamId });
  }
}
