import { describe, expect, it } from 'vitest';
import {
  createDashboardToken,
  getDashboardTokenFromRequest,
  verifyDashboardToken,
  verifyRequestOrigin,
} from './dashboard-token';

const signingKey = 'test-dashboard-signing-key-minimum-length';

describe('dashboard-token', () => {
  it('signs and verifies dashboard websocket tokens with allowed actions', () => {
    const token = createDashboardToken(
      {
        userId: 'user_123',
        orgId: 'org_default',
        subscriptionStatus: 'active',
        allowedActions: ['calls:read', 'calls:write'],
      },
      { secret: signingKey, ttlSeconds: 60, now: new Date('2026-01-01T00:00:00Z') },
    );

    const result = verifyDashboardToken(token, {
      secret: signingKey,
      requiredAction: 'calls:write',
      now: new Date('2026-01-01T00:00:01Z'),
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.payload.userId : '').toBe('user_123');
  });

  it('rejects expired tokens and tokens missing the requested action', () => {
    const token = createDashboardToken(
      {
        userId: 'user_123',
        orgId: 'org_default',
        subscriptionStatus: 'active',
        allowedActions: ['calls:read'],
      },
      { secret: signingKey, ttlSeconds: 10, now: new Date('2026-01-01T00:00:00Z') },
    );

    expect(verifyDashboardToken(token, {
      secret: signingKey,
      requiredAction: 'calls:write',
      now: new Date('2026-01-01T00:00:01Z'),
    }).ok).toBe(false);

    expect(verifyDashboardToken(token, {
      secret: signingKey,
      requiredAction: 'calls:read',
      now: new Date('2026-01-01T00:00:11Z'),
    }).ok).toBe(false);
  });

  it('extracts tokens from bearer authorization and websocket subprotocol headers only', () => {
    const queryReq = { url: '/ws?token=query-token', headers: {} };
    const bearerReq = { url: '/calls/active', headers: { authorization: 'Bearer bearer-token' } };
    const protocolReq = { url: '/ws', headers: { 'sec-websocket-protocol': 'chat, dashboard-token.protocol-token' } };

    expect(getDashboardTokenFromRequest(queryReq)).toBeUndefined();
    expect(getDashboardTokenFromRequest(bearerReq)).toBe('bearer-token');
    expect(getDashboardTokenFromRequest(protocolReq)).toBe('protocol-token');
  });

  it('validates configured request origins', () => {
    expect(verifyRequestOrigin('https://dashboard.example.com', ['https://dashboard.example.com'])).toBe(true);
    expect(verifyRequestOrigin('https://evil.example.com', ['https://dashboard.example.com'])).toBe(false);
    expect(verifyRequestOrigin(undefined, ['https://dashboard.example.com'])).toBe(false);
    expect(verifyRequestOrigin(undefined, [])).toBe(true);
  });
});
