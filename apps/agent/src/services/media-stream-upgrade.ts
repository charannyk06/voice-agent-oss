import type { IncomingMessage } from 'http';

export interface MediaStreamUpgradePolicy {
  allowedIps: string[];
  allowedOrigins: string[];
  maxUpgradesPerWindow: number;
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class MediaStreamUpgradeGuard {
  private readonly buckets = new Map<string, RateLimitEntry>();

  constructor(private readonly policy: MediaStreamUpgradePolicy) {}

  check(req: IncomingMessage, now = Date.now()): { ok: true } | { ok: false; statusCode: number; message: string } {
    const remoteIp = getRemoteIp(req);
    if (this.policy.allowedIps.length > 0 && !this.policy.allowedIps.includes(remoteIp)) {
      return { ok: false, statusCode: 403, message: 'Telephony stream IP is not allowed' };
    }

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    if (this.policy.allowedOrigins.length > 0 && !origin) {
      return { ok: false, statusCode: 403, message: 'Telephony stream origin is required' };
    }
    if (this.policy.allowedOrigins.length > 0 && !this.policy.allowedOrigins.includes(origin)) {
      return { ok: false, statusCode: 403, message: 'Telephony stream origin is not allowed' };
    }

    const existing = this.buckets.get(remoteIp);
    const bucket = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + this.policy.windowMs }
      : existing;

    bucket.count += 1;
    this.buckets.set(remoteIp, bucket);
    if (bucket.count > this.policy.maxUpgradesPerWindow) {
      return { ok: false, statusCode: 429, message: 'Too many telephony stream upgrades' };
    }

    return { ok: true };
  }
}

export function getRemoteIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (firstForwarded?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown')
    .replace(/^::ffff:/, '');
}
