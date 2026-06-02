import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStripeMeterIdentifier,
  evaluateHostedUsageIngestGate,
  getStripeMeterConfig,
  getUsageIngestSecret,
  normalizeUsageQuantity,
  signUsageIngestRequest,
  verifyUsageIngestAuthorization,
} from './usage-metering';

const safeUsageSecret = ['voiceagent', 'usage', 'alpha', 'bravo', 'charlie', 'delta', '1234567890'].join('_');
const unsafeUsageSecret = ['replace', 'with', 'hosted', 'usage', 'value', 'before', 'hosting', '1234567890'].join('_');

test('getUsageIngestSecret reads the internal bearer secret from env', () => {
  assert.equal(getUsageIngestSecret({ BILLING_USAGE_INGEST_SECRET: 'secret' }), 'secret');
  assert.equal(getUsageIngestSecret({}), '');
});

test('verifyUsageIngestAuthorization verifies HMAC over timestamp, usage identity, duration, and raw body', () => {
  const rawBody = '{"orgId":"org_abc","callId":"call_123","durationSeconds":60}';
  const timestamp = '1710000000';
  const secret = safeUsageSecret;
  const signature = signUsageIngestRequest({
    secret,
    rawBody,
    timestamp,
    orgId: 'org_abc',
    callId: 'call_123',
    durationSeconds: 60,
  });

  assert.throws(
    () => verifyUsageIngestAuthorization(new Headers(), { BILLING_USAGE_INGEST_SECRET: '' }),
    /Usage ingest secret is not configured/,
  );
  assert.throws(
    () => verifyUsageIngestAuthorization(
      new Headers({ 'x-usage-timestamp': timestamp, 'x-usage-signature': 'sha256=bad' }),
      { BILLING_USAGE_INGEST_SECRET: safeUsageSecret, DEPLOYMENT_MODE: 'hosted' },
      {
        rawBody,
        orgId: 'org_abc',
        callId: 'call_123',
        durationSeconds: 60,
        now: new Date(Number(timestamp) * 1000),
      },
    ),
    /Unauthorized usage ingest request/,
  );
  assert.throws(
    () => verifyUsageIngestAuthorization(
      new Headers({ 'x-usage-timestamp': '1709990000', 'x-usage-signature': signature }),
      { BILLING_USAGE_INGEST_SECRET: safeUsageSecret, DEPLOYMENT_MODE: 'hosted' },
      {
        rawBody,
        orgId: 'org_abc',
        callId: 'call_123',
        durationSeconds: 60,
        now: new Date(Number(timestamp) * 1000),
      },
    ),
    /timestamp is stale/,
  );
  assert.doesNotThrow(() => verifyUsageIngestAuthorization(
    new Headers({ 'x-usage-timestamp': timestamp, 'x-usage-signature': signature }),
    { BILLING_USAGE_INGEST_SECRET: safeUsageSecret, DEPLOYMENT_MODE: 'hosted' },
    {
      rawBody,
      orgId: 'org_abc',
      callId: 'call_123',
      durationSeconds: 60,
      now: new Date(Number(timestamp) * 1000),
    },
  ));
});

test('verifyUsageIngestAuthorization rejects unsafe hosted ingest secrets', () => {
  assert.throws(
    () => verifyUsageIngestAuthorization(
      new Headers({ 'x-usage-timestamp': '1710000000', 'x-usage-signature': 'sha256=ignored' }),
      {
        BILLING_USAGE_INGEST_SECRET: unsafeUsageSecret,
        DEPLOYMENT_MODE: 'hosted',
      },
      {
        rawBody: '{}',
        orgId: 'org_abc',
        callId: 'call_123',
        durationSeconds: 60,
        now: new Date(1710000000 * 1000),
      },
    ),
    /must not use a documented placeholder or example value/,
  );
  assert.throws(
    () => verifyUsageIngestAuthorization(
      new Headers({ 'x-usage-timestamp': '1710000000', 'x-usage-signature': 'sha256=ignored' }),
      {
        BILLING_USAGE_INGEST_SECRET: unsafeUsageSecret,
        VERCEL_ENV: 'production',
      },
      {
        rawBody: '{}',
        orgId: 'org_abc',
        callId: 'call_123',
        durationSeconds: 60,
        now: new Date(1710000000 * 1000),
      },
    ),
    /must not use a documented placeholder or example value/,
  );
  assert.throws(
    () => verifyUsageIngestAuthorization(
      new Headers({ 'x-usage-timestamp': '1710000000', 'x-usage-signature': 'sha256=ignored' }),
      { BILLING_USAGE_INGEST_SECRET: 'a'.repeat(32), DEPLOYMENT_MODE: 'hosted' },
      {
        rawBody: '{}',
        orgId: 'org_abc',
        callId: 'call_123',
        durationSeconds: 60,
        now: new Date(1710000000 * 1000),
      },
    ),
    /must be high entropy/,
  );
});

test('verifyUsageIngestAuthorization rejects bearer fallback because usage secrets force hosted mode', () => {
  assert.throws(
    () => verifyUsageIngestAuthorization(
      new Headers({ authorization: `Bearer ${safeUsageSecret}` }),
      { BILLING_USAGE_INGEST_SECRET: safeUsageSecret, DEPLOYMENT_MODE: 'self_hosted' },
    ),
    /Unauthorized usage ingest request/,
  );
  assert.throws(
    () => verifyUsageIngestAuthorization(
      new Headers({ authorization: `Bearer ${safeUsageSecret}` }),
      { BILLING_USAGE_INGEST_SECRET: safeUsageSecret, DEPLOYMENT_MODE: 'hosted' },
    ),
    /Unauthorized usage ingest request/,
  );
  assert.throws(
    () => verifyUsageIngestAuthorization(
      new Headers({ authorization: `Bearer ${safeUsageSecret}` }),
      { BILLING_USAGE_INGEST_SECRET: safeUsageSecret, VERCEL_ENV: 'production' },
    ),
    /Unauthorized usage ingest request/,
  );
});

test('hosted usage ingest gate requires a paid active subscription and remaining quota', () => {
  assert.deepEqual(evaluateHostedUsageIngestGate({
    subscriptionStatus: 'active',
    usedSecondsThisPeriod: 30,
    incomingSeconds: 30,
    quotaSeconds: 60,
  }), { allowed: true });

  assert.deepEqual(evaluateHostedUsageIngestGate({
    subscriptionStatus: 'trialing',
    usedSecondsThisPeriod: 0,
    incomingSeconds: 30,
    quotaSeconds: 60,
  }), {
    allowed: false,
    reason: 'subscription_inactive',
    message: 'Hosted usage can only be recorded for an active paid billing subscription.',
  });

  assert.deepEqual(evaluateHostedUsageIngestGate({
    subscriptionStatus: 'active',
    usedSecondsThisPeriod: 31,
    incomingSeconds: 30,
    quotaSeconds: 60,
  }), {
    allowed: false,
    reason: 'quota_exhausted',
    message: 'Hosted usage quota is exhausted for this billing period.',
  });
});

test('getStripeMeterConfig returns null until a meter event name is configured', () => {
  assert.equal(getStripeMeterConfig({}), null);
  assert.deepEqual(getStripeMeterConfig({ STRIPE_METER_EVENT_NAME: 'voice_seconds' }), {
    eventName: 'voice_seconds',
    customerKey: 'stripe_customer_id',
    valueKey: 'value',
  });
  assert.deepEqual(getStripeMeterConfig({
    STRIPE_METER_EVENT_NAME: 'voice_seconds',
    STRIPE_METER_CUSTOMER_KEY: 'customer',
    STRIPE_METER_VALUE_KEY: 'seconds',
  }), {
    eventName: 'voice_seconds',
    customerKey: 'customer',
    valueKey: 'seconds',
  });
});

test('createStripeMeterIdentifier is scoped per organization and hides raw call ids', () => {
  const first = createStripeMeterIdentifier('org_1', 'call_shared');
  const second = createStripeMeterIdentifier('org_2', 'call_shared');
  assert.notEqual(first, second);
  assert.match(first, /^voice_call_[a-f0-9]{40}$/);
  assert.equal(first.includes('call_shared'), false);
});

test('normalizeUsageQuantity rounds up partial voice seconds and rejects invalid values', () => {
  assert.equal(normalizeUsageQuantity(1.1), 2);
  assert.equal(normalizeUsageQuantity(30), 30);
  assert.throws(() => normalizeUsageQuantity(0), /durationSeconds must be a positive number/);
  assert.throws(() => normalizeUsageQuantity(Number.NaN), /durationSeconds must be a positive number/);
});
