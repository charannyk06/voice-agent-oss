import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowsHostedTrialingUsage,
  getDeploymentMode,
  getHostedIncludedMinutes,
  getHostedQuotaSeconds,
  isQuotaExhausted,
  isSubscriptionUsable,
  redactStripeId,
  usagePercent,
} from './billing';

test('getDeploymentMode defaults to self hosted unless hosted or protected by billing signals', () => {
  assert.equal(getDeploymentMode({ DEPLOYMENT_MODE: undefined }), 'self_hosted');
  assert.equal(getDeploymentMode({ DEPLOYMENT_MODE: 'hosted' }), 'hosted');
  assert.equal(getDeploymentMode({ DEPLOYMENT_MODE: 'self_hosted' }), 'self_hosted');
  assert.equal(getDeploymentMode({ DEPLOYMENT_MODE: 'self_hosted', STRIPE_SECRET_KEY: 'stripe_secret_fixture', STRIPE_PRICE_ID: 'price_x' }), 'hosted');
  assert.equal(getDeploymentMode({ DEPLOYMENT_MODE: 'weird' }), 'self_hosted');
});

test('getDeploymentMode fails closed to hosted when production billing env is present', () => {
  assert.equal(getDeploymentMode({ VERCEL_ENV: 'production', STRIPE_SECRET_KEY: 'stripe_live_secret_fixture', STRIPE_PRICE_ID: 'price_x' }), 'hosted');
  assert.equal(getDeploymentMode({ VERCEL_ENV: 'production', DEPLOYMENT_MODE: 'self_hosted', STRIPE_SECRET_KEY: 'stripe_live_secret_fixture', STRIPE_PRICE_ID: 'price_x' }), 'hosted');
  assert.equal(getDeploymentMode({ VERCEL_ENV: 'production', DEPLOYMENT_MODE: 'weird', BILLING_USAGE_INGEST_SECRET: 'usage_secret' }), 'hosted');
  assert.equal(getDeploymentMode({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'stripe_live_secret_fixture', STRIPE_PRICE_BASE_MONTHLY: 'price_x' }), 'hosted');
  assert.equal(getDeploymentMode({ VERCEL_ENV: 'production', BILLING_USAGE_INGEST_SECRET: 'usage_secret' }), 'hosted');
  assert.equal(getDeploymentMode({ VERCEL_ENV: 'production', STRIPE_PRICE_ID: 'price_x' }), 'self_hosted');
});

test('isSubscriptionUsable requires paid active subscriptions by default', () => {
  assert.equal(isSubscriptionUsable('active'), true);
  assert.equal(isSubscriptionUsable('trialing'), false);
  assert.equal(isSubscriptionUsable('trialing', { HOSTED_ALLOW_TRIALING_USAGE: 'true' }), true);
  assert.equal(allowsHostedTrialingUsage({ HOSTED_ALLOW_TRIALING_USAGE: 'true' }), true);
  assert.equal(isSubscriptionUsable('past_due'), false);
  assert.equal(isSubscriptionUsable(null), false);
});

test('redactStripeId keeps identifiers useful without leaking full values', () => {
  assert.equal(redactStripeId('cus_1234567890abcdef'), 'cus_****cdef');
  assert.equal(redactStripeId(null), null);
});

test('usagePercent clamps and handles empty quota', () => {
  assert.equal(usagePercent(50, 100), 50);
  assert.equal(usagePercent(150, 100), 100);
  assert.equal(usagePercent(50, 0), 0);
});

test('hosted included minutes fallback keeps active subscriptions hard capped', () => {
  assert.equal(getHostedIncludedMinutes({}), 60);
  assert.equal(getHostedIncludedMinutes({ HOSTED_MONTHLY_INCLUDED_MINUTES: '25' }), 25);
  assert.equal(getHostedIncludedMinutes({ HOSTED_MONTHLY_INCLUDED_MINUTES: '0' }), 60);
  assert.equal(getHostedQuotaSeconds(0, { HOSTED_MONTHLY_INCLUDED_MINUTES: '25' }), 1500);
  assert.equal(getHostedQuotaSeconds(10, { HOSTED_MONTHLY_INCLUDED_MINUTES: '25' }), 600);
  assert.equal(isQuotaExhausted(600, 600), true);
  assert.equal(isQuotaExhausted(599, 600), false);
});
