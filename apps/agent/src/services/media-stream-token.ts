import { createHmac, timingSafeEqual } from 'crypto';

export interface MediaStreamTokenPayload {
  sessionId: string;
  providerCallId: string;
  orgId: string;
  iat: number;
  exp: number;
}

type CreateMediaStreamTokenInput = {
  secret: string;
  sessionId: string;
  providerCallId: string;
  orgId: string;
  nowSeconds?: number;
  expiresInSeconds?: number;
};

type VerifyMediaStreamTokenInput = {
  secret: string;
  expectedSessionId?: string;
  expectedProviderCallId?: string;
  expectedOrgId?: string;
  nowSeconds?: number;
};

export type MediaStreamTokenVerification =
  | { ok: true; payload: MediaStreamTokenPayload }
  | { ok: false; reason: 'missing_secret' | 'missing_token' | 'invalid_format' | 'invalid_signature' | 'expired' | 'scope_mismatch' };

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createMediaStreamToken(input: CreateMediaStreamTokenInput): string {
  if (!input.secret) {
    throw new Error('Media stream token secret is required');
  }

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const payload: MediaStreamTokenPayload = {
    sessionId: input.sessionId,
    providerCallId: input.providerCallId,
    orgId: input.orgId,
    iat: nowSeconds,
    exp: nowSeconds + (input.expiresInSeconds ?? 120),
  };

  const encodedPayload = base64url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload, input.secret)}`;
}

export function verifyMediaStreamToken(
  token: string | undefined | null,
  input: VerifyMediaStreamTokenInput,
): MediaStreamTokenVerification {
  if (!input.secret) {
    return { ok: false, reason: 'missing_secret' };
  }
  if (!token) {
    return { ok: false, reason: 'missing_token' };
  }

  const [encodedPayload, signature, extra] = token.split('.');
  if (!encodedPayload || !signature || extra !== undefined) {
    return { ok: false, reason: 'invalid_format' };
  }

  const expectedSignature = sign(encodedPayload, input.secret);
  if (!safeEqual(signature, expectedSignature)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  let payload: MediaStreamTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as MediaStreamTokenPayload;
  } catch {
    return { ok: false, reason: 'invalid_format' };
  }

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    return { ok: false, reason: 'expired' };
  }

  if (
    (input.expectedSessionId && payload.sessionId !== input.expectedSessionId) ||
    (input.expectedProviderCallId && payload.providerCallId !== input.expectedProviderCallId) ||
    (input.expectedOrgId && payload.orgId !== input.expectedOrgId)
  ) {
    return { ok: false, reason: 'scope_mismatch' };
  }

  return { ok: true, payload };
}
