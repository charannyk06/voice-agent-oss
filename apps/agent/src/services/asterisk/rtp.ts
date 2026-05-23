import dgram from 'dgram';

const RTP_HEADER_BYTES = 12;
const RTP_VERSION = 2;
const RTP_PAYLOAD_TYPE_ULAW = 0;
const RTP_FRAME_DURATION_MS = 20;
const RTP_FRAME_SAMPLE_COUNT = 160;
const MU_LAW_SILENCE = 0xff;

export interface ParsedRtpPacket {
  payload: Buffer;
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
}

function randomUnsignedInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

export function parseRtpPacket(packet: Buffer): ParsedRtpPacket | null {
  if (packet.length < RTP_HEADER_BYTES) {
    return null;
  }

  const version = packet[0] >> 6;
  if (version !== RTP_VERSION) {
    return null;
  }

  const csrcCount = packet[0] & 0x0f;
  const hasExtension = (packet[0] & 0x10) !== 0;
  let headerLength = RTP_HEADER_BYTES + (csrcCount * 4);

  if (packet.length < headerLength) {
    return null;
  }

  if (hasExtension) {
    if (packet.length < headerLength + 4) {
      return null;
    }
    const extensionLengthWords = packet.readUInt16BE(headerLength + 2);
    headerLength += 4 + (extensionLengthWords * 4);
  }

  if (packet.length < headerLength) {
    return null;
  }

  return {
    payload: packet.subarray(headerLength),
    payloadType: packet[1] & 0x7f,
    sequenceNumber: packet.readUInt16BE(2),
    timestamp: packet.readUInt32BE(4),
    ssrc: packet.readUInt32BE(8),
  };
}

export function createRtpPacket(params: {
  payload: Buffer;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  payloadType?: number;
}): Buffer {
  const packet = Buffer.alloc(RTP_HEADER_BYTES + params.payload.length);
  packet[0] = RTP_VERSION << 6;
  packet[1] = params.payloadType ?? RTP_PAYLOAD_TYPE_ULAW;
  packet.writeUInt16BE(params.sequenceNumber & 0xffff, 2);
  packet.writeUInt32BE(params.timestamp >>> 0, 4);
  packet.writeUInt32BE(params.ssrc >>> 0, 8);
  params.payload.copy(packet, RTP_HEADER_BYTES);
  return packet;
}

export class AsteriskExternalMediaTransport {
  private readonly socket = dgram.createSocket('udp4');
  private readonly bindAddress: string;
  private readonly bindPort?: number;
  private remoteAddress?: string;
  private remotePort?: number;
  private frameQueue = Buffer.alloc(0);
  private flushTimer: NodeJS.Timeout | null = null;
  private isClosed = false;
  private readonly ssrc = randomUnsignedInt(0xffffffff);
  private sequenceNumber = randomUnsignedInt(0xffff);
  private timestamp = randomUnsignedInt(0xffffffff);

  constructor(options: {
    advertisedHost: string;
    bindAddress?: string;
    bindPort?: number;
    onAudioFrame: (mulawBase64: string) => void;
  }) {
    this.advertisedHost = options.advertisedHost;
    this.bindAddress = options.bindAddress || '0.0.0.0';
    this.bindPort = options.bindPort;
    this.onAudioFrame = options.onAudioFrame;

    this.socket.on('message', (packet, remote) => {
      const parsed = parseRtpPacket(packet);
      if (!parsed || parsed.payloadType !== RTP_PAYLOAD_TYPE_ULAW || parsed.payload.length === 0) {
        return;
      }

      if (!this.remoteAddress || !this.remotePort) {
        this.remoteAddress = remote.address;
        this.remotePort = remote.port;
      }

      this.onAudioFrame(parsed.payload.toString('base64'));
    });

    this.socket.on('error', (error) => {
      console.error('[Asterisk RTP] Socket error:', error);
    });
  }

  private readonly advertisedHost: string;
  private readonly onAudioFrame: (mulawBase64: string) => void;

  async start(): Promise<{ host: string; port: number }> {
    const port = await new Promise<number>((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.bindPort ?? 0, this.bindAddress, () => {
        this.socket.off('error', reject);
        const address = this.socket.address();
        if (typeof address === 'string') {
          reject(new Error('Expected an IPv4 UDP socket address'));
          return;
        }
        resolve(address.port);
      });
    });

    return {
      host: this.advertisedHost,
      port,
    };
  }

  setRemoteTarget(address: string, port: number): void {
    if (!address || !port) {
      return;
    }
    this.remoteAddress = address;
    this.remotePort = port;
  }

  sendMulawAudio(mulawBase64: string): void {
    if (this.isClosed) {
      return;
    }

    const chunk = Buffer.from(mulawBase64, 'base64');
    if (chunk.length === 0) {
      return;
    }

    this.frameQueue = Buffer.concat([this.frameQueue, chunk]);
    this.ensureFlushTimer();
  }

  clearAudio(): void {
    this.frameQueue = Buffer.alloc(0);
  }

  close(): void {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.socket.close();
  }

  private ensureFlushTimer(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      this.flushNextFrame();
    }, RTP_FRAME_DURATION_MS);
    this.flushTimer.unref();
  }

  private flushNextFrame(): void {
    if (this.isClosed || !this.remoteAddress || !this.remotePort) {
      return;
    }

    if (this.frameQueue.length === 0) {
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }
      return;
    }

    const payload = Buffer.alloc(RTP_FRAME_SAMPLE_COUNT, MU_LAW_SILENCE);
    const slice = this.frameQueue.subarray(0, RTP_FRAME_SAMPLE_COUNT);
    slice.copy(payload);
    this.frameQueue = this.frameQueue.subarray(slice.length);

    const packet = createRtpPacket({
      payload,
      sequenceNumber: this.sequenceNumber,
      timestamp: this.timestamp,
      ssrc: this.ssrc,
    });

    this.sequenceNumber = (this.sequenceNumber + 1) & 0xffff;
    this.timestamp = (this.timestamp + RTP_FRAME_SAMPLE_COUNT) >>> 0;

    this.socket.send(packet, this.remotePort, this.remoteAddress, (error) => {
      if (error) {
        console.error('[Asterisk RTP] Failed to send packet:', error);
      }
    });
  }
}

export {
  MU_LAW_SILENCE,
  RTP_FRAME_DURATION_MS,
  RTP_FRAME_SAMPLE_COUNT,
  RTP_PAYLOAD_TYPE_ULAW,
};
