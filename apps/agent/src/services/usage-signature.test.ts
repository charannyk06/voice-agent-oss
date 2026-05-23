import { describe, expect, it } from 'vitest';
import { signUsageIngestRequest } from './usage-signature';

describe('usage ingest signatures', () => {
  it('binds the signature to timestamp, usage identity, duration, and exact raw body', () => {
    const common = {
      secret: 's'.repeat(32),
      timestamp: '1710000000',
      orgId: 'org_abc',
      callId: 'call_123',
      durationSeconds: 61,
    };

    const first = signUsageIngestRequest({ ...common, rawBody: '{"orgId":"org_abc","callId":"call_123","durationSeconds":61}' });
    const reordered = signUsageIngestRequest({ ...common, rawBody: '{"callId":"call_123","orgId":"org_abc","durationSeconds":61}' });

    expect(first).toMatch(/^sha256=/);
    expect(first).not.toBe(reordered);
  });
});
