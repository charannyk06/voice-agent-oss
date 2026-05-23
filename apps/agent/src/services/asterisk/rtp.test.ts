import { describe, expect, it } from 'vitest';
import { createRtpPacket, parseRtpPacket } from './rtp';

describe('RTP helpers', () => {
  it('round-trips a ulaw RTP packet', () => {
    const packet = createRtpPacket({
      payload: Buffer.from([0xff, 0x7f, 0x55, 0xaa]),
      sequenceNumber: 42,
      timestamp: 160,
      ssrc: 1234,
    });

    const parsed = parseRtpPacket(packet);
    expect(parsed).not.toBeNull();
    expect(parsed?.sequenceNumber).toBe(42);
    expect(parsed?.timestamp).toBe(160);
    expect(parsed?.ssrc).toBe(1234);
    expect(Array.from(parsed?.payload || [])).toEqual([0xff, 0x7f, 0x55, 0xaa]);
  });

  it('rejects non-RTP buffers', () => {
    expect(parseRtpPacket(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
  });
});
