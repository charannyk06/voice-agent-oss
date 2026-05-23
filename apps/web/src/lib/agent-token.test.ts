import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentToken, verifyAgentToken } from './agent-token';

const signingKey = 'test-dashboard-signing-key-minimum-length';

test('createAgentToken and verifyAgentToken round trip allowed actions', () => {
  const token = createAgentToken({
    userId: 'user_123',
    orgId: 'org_default',
    subscriptionStatus: 'active',
    allowedActions: ['calls:read', 'calls:write'],
  }, { secret: signingKey, ttlSeconds: 60, now: new Date('2026-01-01T00:00:00Z') });

  const result = verifyAgentToken(token, {
    secret: signingKey,
    requiredAction: 'calls:write',
    now: new Date('2026-01-01T00:00:01Z'),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.orgId, 'org_default');
  }
});

test('verifyAgentToken rejects tampered signatures', () => {
  const token = createAgentToken({
    userId: 'user_123',
    orgId: 'org_default',
    subscriptionStatus: 'active',
    allowedActions: ['calls:read'],
  }, { secret: signingKey, ttlSeconds: 60, now: new Date('2026-01-01T00:00:00Z') });

  assert.equal(verifyAgentToken(`${token}x`, { secret: signingKey, requiredAction: 'calls:read' }).ok, false);
});
