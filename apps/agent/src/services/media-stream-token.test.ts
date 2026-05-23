import { describe, expect, it } from 'vitest';
import { createMediaStreamToken, verifyMediaStreamToken } from './media-stream-token';

const signingKey = 'test-media-stream-signing-key-minimum-length';

describe('media stream tokens', () => {
  it('round trips scoped stream claims', () => {
    const token = createMediaStreamToken({
      secret: signingKey,
      sessionId: 'call-1',
      providerCallId: 'provider-1',
      orgId: 'org-1',
      nowSeconds: 1_000,
      expiresInSeconds: 60,
    });

    const verified = verifyMediaStreamToken(token, {
      secret: signingKey,
      expectedSessionId: 'call-1',
      expectedProviderCallId: 'provider-1',
      expectedOrgId: 'org-1',
      nowSeconds: 1_030,
    });

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.orgId).toBe('org-1');
    }
  });

  it('rejects tampered or cross-session stream claims', () => {
    const token = createMediaStreamToken({
      secret: signingKey,
      sessionId: 'call-1',
      providerCallId: 'provider-1',
      orgId: 'org-1',
      nowSeconds: 1_000,
      expiresInSeconds: 60,
    });

    expect(verifyMediaStreamToken(`${token}x`, { secret: signingKey, nowSeconds: 1_010 }).ok).toBe(false);
    expect(verifyMediaStreamToken(token, {
      secret: signingKey,
      expectedSessionId: 'call-2',
      nowSeconds: 1_010,
    }).ok).toBe(false);
  });

  it('rejects expired or missing-signing-key tokens', () => {
    const token = createMediaStreamToken({
      secret: signingKey,
      sessionId: 'call-1',
      providerCallId: 'provider-1',
      orgId: 'org-1',
      nowSeconds: 1_000,
      expiresInSeconds: 5,
    });

    expect(verifyMediaStreamToken(token, { secret: signingKey, nowSeconds: 1_006 }).ok).toBe(false);
    expect(verifyMediaStreamToken(token, { secret: '', nowSeconds: 1_001 }).ok).toBe(false);
  });
});
