import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAllowedRequestOrigins,
  isAllowedMutationOrigin,
  isMutationMethod,
  normalizeOrigin,
} from './request-security';

test('isMutationMethod treats safe HTTP methods as non-mutating', () => {
  assert.equal(isMutationMethod('GET'), false);
  assert.equal(isMutationMethod('HEAD'), false);
  assert.equal(isMutationMethod('OPTIONS'), false);
  assert.equal(isMutationMethod('POST'), true);
  assert.equal(isMutationMethod('DELETE'), true);
});

test('normalizeOrigin accepts only valid URL origins', () => {
  assert.equal(normalizeOrigin('https://app.example.com/settings?x=1'), 'https://app.example.com');
  assert.equal(normalizeOrigin('not-a-url'), null);
  assert.equal(normalizeOrigin(undefined), null);
});

test('getAllowedRequestOrigins includes request, app, public, and explicit origins', () => {
  assert.deepEqual(
    [...getAllowedRequestOrigins('https://tenant.example.com', {
      NEXT_PUBLIC_APP_URL: 'https://dashboard.example.com/path',
      PUBLIC_APP_URL: 'https://public.example.com',
      CSRF_ALLOWED_ORIGINS: 'https://admin.example.com, bad-value',
    })].sort(),
    [
      'https://admin.example.com',
      'https://dashboard.example.com',
      'https://public.example.com',
      'https://tenant.example.com',
    ],
  );
});

test('isAllowedMutationOrigin requires origin or referer for mutations', () => {
  const env = { NEXT_PUBLIC_APP_URL: 'https://app.example.com' };
  assert.equal(isAllowedMutationOrigin({
    method: 'GET',
    requestOrigin: 'https://app.example.com',
    env,
  }), true);
  assert.equal(isAllowedMutationOrigin({
    method: 'POST',
    requestOrigin: 'https://app.example.com',
    originHeader: 'https://app.example.com',
    env,
  }), true);
  assert.equal(isAllowedMutationOrigin({
    method: 'POST',
    requestOrigin: 'https://app.example.com',
    refererHeader: 'https://app.example.com/settings',
    env,
  }), true);
  assert.equal(isAllowedMutationOrigin({
    method: 'POST',
    requestOrigin: 'https://app.example.com',
    originHeader: 'https://evil.example.com',
    env,
  }), false);
  assert.equal(isAllowedMutationOrigin({
    method: 'POST',
    requestOrigin: 'https://app.example.com',
    env,
  }), false);
});
