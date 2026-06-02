import { describe, expect, it } from 'vitest';
import { config } from '../../config';
import { AsteriskAriRuntime, parseAppArgs } from './ari-runtime';

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

  it('runs billing preflight before creating ARI media resources', async () => {
    const originalGeminiKey = config.gemini.apiKey;
    config.gemini.apiKey = 'test-gemini-key';
    const calls: string[] = [];
    const fakeAriClient = {
      isConfigured: () => true,
      hangupChannel: async (channelId: string) => {
        calls.push(`hangup:${channelId}`);
      },
      createBridge: async () => {
        calls.push('createBridge');
      },
      createExternalMediaChannel: async () => {
        calls.push('createExternalMediaChannel');
        return {};
      },
      addChannelsToBridge: async () => {
        calls.push('addChannelsToBridge');
      },
      getChannelVariable: async () => null,
    };
    const runtime = new AsteriskAriRuntime({
      onAudioFrame: () => undefined,
      onCallEnded: async () => {
        calls.push('ended');
      },
      onCallPreflight: async () => {
        calls.push('preflight');
        throw new Error('billing blocked');
      },
      onCallReady: async () => {
        calls.push('ready');
      },
    }, fakeAriClient as never);

    try {
      await (runtime as unknown as {
        startCall(event: unknown): Promise<void>;
      }).startCall({
        channel: { id: 'asterisk-in-1', caller: { number: '+155****0000' } },
        args: ['inbound_route=frontdesk'],
      });
    } finally {
      config.gemini.apiKey = originalGeminiKey;
    }

    expect(calls).toEqual(['preflight', 'hangup:asterisk-in-1']);
  });
});
