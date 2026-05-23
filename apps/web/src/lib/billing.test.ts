import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDeploymentMode,
  isSubscriptionUsable,
  redactStripeId,
  usagePercent,
} from './billing';

test('getDeploymentMode defaults to self hosted unless explicitly hosted', () => {
  assert.equal(getDeploymentMode({ DEPLOYMENT_MODE: undefined }), 'self_hosted');
  assert.equal(getDeploymentMode({ DEPLOYMENT_MODE: 'hosted' }), 'hosted');
  assert.equal(getDeploymentMode({ DEPLOYMENT_MODE: 'weird' }), 'self_hosted');
});

test('isSubscriptionUsable accepts active and trialing only', () => {
  assert.equal(isSubscriptionUsable('active'), true);
  assert.equal(isSubscriptionUsable('trialing'), true);
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
