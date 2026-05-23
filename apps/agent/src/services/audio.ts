const MU_LAW_BIAS = 0x84;
const MU_LAW_CLIP = 32635;

function linearToMuLawSample(sample: number): number {
  let sign = 0;
  let magnitude = sample;

  if (magnitude < 0) {
    sign = 0x80;
    magnitude = -magnitude;
  }

  if (magnitude > MU_LAW_CLIP) {
    magnitude = MU_LAW_CLIP;
  }

  magnitude += MU_LAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (magnitude & expMask) === 0 && exponent > 0; exponent -= 1) {
    expMask >>= 1;
  }

  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  const muLaw = ~(sign | (exponent << 4) | mantissa);
  return muLaw & 0xff;
}

function muLawToLinearSample(muLawValue: number): number {
  const muLaw = ~muLawValue & 0xff;
  const sign = muLaw & 0x80;
  const exponent = (muLaw >> 4) & 0x07;
  const mantissa = muLaw & 0x0f;
  const magnitude = ((mantissa << 3) + MU_LAW_BIAS) << exponent;
  const sample = magnitude - MU_LAW_BIAS;
  return sign ? -sample : sample;
}

export function decodeTwilioMulaw(base64Payload: string): Buffer {
  const muLaw = Buffer.from(base64Payload, 'base64');
  const pcm = Buffer.alloc(muLaw.length * 2);

  for (let i = 0; i < muLaw.length; i += 1) {
    const sample = muLawToLinearSample(muLaw[i]);
    pcm.writeInt16LE(sample, i * 2);
  }

  return pcm;
}

export function encodeTwilioMulaw(pcm16le: Buffer): string {
  const sampleCount = Math.floor(pcm16le.length / 2);
  const muLaw = Buffer.alloc(sampleCount);

  for (let i = 0; i < sampleCount; i += 1) {
    const sample = pcm16le.readInt16LE(i * 2);
    muLaw[i] = linearToMuLawSample(sample);
  }

  return muLaw.toString('base64');
}

export function resamplePcm16(
  pcm16le: Buffer,
  fromSampleRate: number,
  toSampleRate: number,
): Buffer {
  if (fromSampleRate === toSampleRate || pcm16le.length === 0) {
    return Buffer.from(pcm16le);
  }

  const sampleCount = Math.floor(pcm16le.length / 2);
  if (sampleCount === 0) {
    return Buffer.alloc(0);
  }

  const input = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    input[i] = pcm16le.readInt16LE(i * 2);
  }

  const outputLength = Math.max(1, Math.round(sampleCount * (toSampleRate / fromSampleRate)));
  const output = Buffer.alloc(outputLength * 2);
  const ratio = fromSampleRate / toSampleRate;

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, sampleCount - 1);
    const blend = sourceIndex - leftIndex;
    const left = input[leftIndex] ?? 0;
    const right = input[rightIndex] ?? left;
    const interpolated = Math.round(left + (right - left) * blend);
    output.writeInt16LE(interpolated, i * 2);
  }

  return output;
}

export function parseSampleRate(mimeType: string | undefined, fallback: number): number {
  if (!mimeType) {
    return fallback;
  }

  const match = mimeType.match(/rate=(\d+)/i);
  if (!match) {
    return fallback;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
