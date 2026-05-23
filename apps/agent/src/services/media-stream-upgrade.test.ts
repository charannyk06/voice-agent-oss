import { describe, expect, it } from 'vitest';
import { MediaStreamUpgradeGuard } from './media-stream-upgrade';

function request(ip: string, origin?: string) {
  return {
    headers: {
      ...(origin ? { origin } : {}),
    },
    socket: { remoteAddress: ip },
  } as never;
}

describe('MediaStreamUpgradeGuard', () => {
  it('allows Twilio and Plivo compatible upgrades when allowlists are empty', () => {
    const guard = new MediaStreamUpgradeGuard({
      allowedIps: [],
      allowedOrigins: [],
      maxUpgradesPerWindow: 2,
      windowMs: 1000,
    });

    expect(guard.check(request('203.0.113.10'))).toEqual({ ok: true });
  });

  it('enforces exact IP and origin allowlists when configured', () => {
    const guard = new MediaStreamUpgradeGuard({
      allowedIps: ['203.0.113.10'],
      allowedOrigins: ['https://voice.example.com'],
      maxUpgradesPerWindow: 2,
      windowMs: 1000,
    });

    expect(guard.check(request('203.0.113.11', 'https://voice.example.com')).ok).toBe(false);
    expect(guard.check(request('203.0.113.10', 'https://other.example.com')).ok).toBe(false);
    expect(guard.check(request('203.0.113.10', 'https://voice.example.com'))).toEqual({ ok: true });
  });

  it('rate limits upgrades per remote IP', () => {
    const guard = new MediaStreamUpgradeGuard({
      allowedIps: [],
      allowedOrigins: [],
      maxUpgradesPerWindow: 1,
      windowMs: 1000,
    });

    expect(guard.check(request('203.0.113.10'), 1000)).toEqual({ ok: true });
    expect(guard.check(request('203.0.113.10'), 1001)).toEqual({
      ok: false,
      statusCode: 429,
      message: 'Too many telephony stream upgrades',
    });
    expect(guard.check(request('203.0.113.10'), 2001)).toEqual({ ok: true });
  });
});
