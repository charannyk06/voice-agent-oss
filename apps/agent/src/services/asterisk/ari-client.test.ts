import { describe, expect, it } from 'vitest';
import { buildAriEventsWebSocketUrl } from './ari-client';

describe('buildAriEventsWebSocketUrl', () => {
  it('builds a websocket URL from an http ARI base URL', () => {
    expect(buildAriEventsWebSocketUrl('http://asterisk:8088/ari', 'voice-agent')).toBe(
      'ws://asterisk:8088/ari/events?app=voice-agent',
    );
  });

  it('builds a secure websocket URL from an https ARI base URL', () => {
    expect(buildAriEventsWebSocketUrl('https://pbx.example.com/ari/', 'voice-agent')).toBe(
      'wss://pbx.example.com/ari/events?app=voice-agent',
    );
  });
});
