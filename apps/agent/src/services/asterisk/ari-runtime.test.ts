import { describe, expect, it } from 'vitest';
import { parseAppArgs } from './ari-runtime';

describe('parseAppArgs', () => {
  it('parses key value stasis args', () => {
    expect(parseAppArgs(['direction=inbound', 'caller_number=+15551230000'])).toEqual({
      direction: 'inbound',
      caller_number: '+15551230000',
    });
  });

  it('ignores malformed entries', () => {
    expect(parseAppArgs(['direction=inbound', 'bad-entry', 'dialed_number=1001'])).toEqual({
      direction: 'inbound',
      dialed_number: '1001',
    });
  });
});
