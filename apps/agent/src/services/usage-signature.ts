import { createHmac, timingSafeEqual } from 'crypto';

export function buildUsageSignaturePayload(params: {
  rawBody: string;
  timestamp: string;
  orgId: string;
  callId: string;
  durationSeconds: number;
}): string {
  return [
    params.timestamp,
    params.orgId,
    params.callId,
    String(params.durationSeconds),
    params.rawBody,
  ].join('.');
}

export function signUsageIngestRequest(params: {
  secret: string;
  rawBody: string;
  timestamp: string;
  orgId: string;
  callId: string;
  durationSeconds: number;
}): string {
  return `sha256=${createHmac('sha256', params.secret)
    .update(buildUsageSignaturePayload(params))
    .digest('base64')}`;
}

export function safeSignatureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
