import { describe, expect, it } from 'vitest';
import { buildPlivoV3BaseString, createPlivoV3Signature, verifyPlivoV3Signature } from './plivo';

describe('Plivo V3 signature helpers', () => {
  it('builds the POST base string from URL, sorted key/value params, and nonce', () => {
    expect(buildPlivoV3BaseString(
      'https://agent.example.com/webhook/plivo/answer',
      { To: '+15550000002', From: '+15550000001', CallUUID: 'call-1' },
      'nonce-1',
    )).toBe('https://agent.example.com/webhook/plivo/answer?CallUUIDcall-1From+15550000001To+15550000002.nonce-1');
  });

  it('preserves sorted query params before sorted POST params', () => {
    expect(buildPlivoV3BaseString(
      'https://agent.example.com/webhook/plivo/answer?b=2&a=1',
      { To: '+15550000002', From: '+15550000001' },
      'nonce-1',
    )).toBe('https://agent.example.com/webhook/plivo/answer?a=1&b=2.From+15550000001To+15550000002.nonce-1');
  });

  it('verifies signatures using constant-time compatible exact comparison inputs', () => {
    const signature = createPlivoV3Signature({
      authToken: 'auth-token',
      url: 'https://agent.example.com/webhook/plivo/answer',
      formParams: { To: '+15550000002', From: '+15550000001' },
      nonce: 'nonce-1',
    });

    expect(verifyPlivoV3Signature({
      authToken: 'auth-token',
      url: 'https://agent.example.com/webhook/plivo/answer',
      formParams: { From: '+15550000001', To: '+15550000002' },
      nonce: 'nonce-1',
      signature: `old-signature,${signature}`,
    })).toBe(true);

    expect(verifyPlivoV3Signature({
      authToken: 'auth-token',
      url: 'https://agent.example.com/webhook/plivo/answer',
      formParams: { From: '+15550000001', To: '+15550000003' },
      nonce: 'nonce-1',
      signature,
    })).toBe(false);
  });
});
