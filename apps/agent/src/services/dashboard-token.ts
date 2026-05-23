import { createHmac, timingSafeEqual } from 'crypto';

export type DashboardTokenAction = 'calls:read' | 'calls:write' | 'billing:read';

export interface DashboardTokenPayload {
  userId: string;
  orgId: string;
  subscriptionStatus: string;
  allowedActions: DashboardTokenAction[];
  exp?: number;
  iat?: number;
}

interface TokenOptions {
  secret: string;
  ttlSeconds?: number;
  now?: Date;
}

interface VerifyOptions {
  secret: string;
  requiredAction?: DashboardTokenAction;
  now?: Date;
}

interface RequestLike {
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export type TokenVerifyResult =
  | { ok: true; payload: DashboardTokenPayload }
  | { ok: false; reason: string };

function encodeBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function headerValue(headers: RequestLike['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0];
  return direct;
}

export function createDashboardToken(
  payload: Omit<DashboardTokenPayload, 'exp' | 'iat'>,
  options: TokenOptions,
): string {
  if (!options.secret) {
    throw new Error('Dashboard token secret is required');
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const tokenPayload: DashboardTokenPayload = {
    ...payload,
    iat: nowSeconds,
    exp: nowSeconds + (options.ttlSeconds ?? 60),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(tokenPayload));
  const signature = signPayload(encodedPayload, options.secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyDashboardToken(token: string | undefined, options: VerifyOptions): TokenVerifyResult {
  if (!token) {
    return { ok: false, reason: 'missing_token' };
  }
  if (!options.secret) {
    return { ok: false, reason: 'missing_secret' };
  }

  const [encodedPayload, signature, extra] = token.split('.');
  if (!encodedPayload || !signature || extra !== undefined) {
    return { ok: false, reason: 'malformed_token' };
  }

  const expectedSignature = signPayload(encodedPayload, options.secret);
  if (!safeEqual(signature, expectedSignature)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  let payload: DashboardTokenPayload;
  try {
    payload = JSON.parse(decodeBase64Url(encodedPayload)) as DashboardTokenPayload;
  } catch {
    return { ok: false, reason: 'invalid_payload' };
  }

  if (!payload.userId || !payload.orgId || !Array.isArray(payload.allowedActions)) {
    return { ok: false, reason: 'invalid_claims' };
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    return { ok: false, reason: 'expired_token' };
  }

  if (options.requiredAction && !payload.allowedActions.includes(options.requiredAction)) {
    return { ok: false, reason: 'missing_action' };
  }

  return { ok: true, payload };
}

export function getDashboardTokenFromRequest(req: RequestLike): string | undefined {
  const authorization = headerValue(req.headers, 'authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice('bearer '.length).trim();
  }

  const protocolToken = headerValue(req.headers, 'sec-websocket-protocol');
  if (protocolToken) {
    const match = protocolToken
      .split(',')
      .map((value) => value.trim())
      .find((value) => value.startsWith('dashboard-token.'));
    if (match) return match.slice('dashboard-token.'.length);
  }

  return undefined;
}

export function verifyRequestOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) {
    return true;
  }
  if (!origin) {
    return false;
  }
  return allowedOrigins.includes(origin);
}
