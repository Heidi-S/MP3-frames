/**
 * Test-only MP3 byte builders.
 *
 * These construct MPEG frames and ID3 tags from raw field values so tests can
 * produce both valid streams and deliberately invalid ones (reserved bitrates,
 * MPEG-2 headers, malformed sync words, ...). Nothing here is used by the
 * application at runtime.
 */

import { ChannelMode, MpegLayerId, MpegVersionId } from '../../src/parser/constants.js';

export const BITRATE_INDEX_BY_KBPS: ReadonlyMap<number, number> = new Map([
  [32, 1],
  [40, 2],
  [48, 3],
  [56, 4],
  [64, 5],
  [80, 6],
  [96, 7],
  [112, 8],
  [128, 9],
  [160, 10],
  [192, 11],
  [224, 12],
  [256, 13],
  [320, 14],
]);

export const SAMPLE_RATE_INDEX_BY_HZ: ReadonlyMap<number, number> = new Map([
  [44_100, 0],
  [48_000, 1],
  [32_000, 2],
]);

export interface FrameSpec {
  /** Raw 2-bit MPEG version id. Defaults to MPEG-1. */
  readonly versionId?: number;
  /** Raw 2-bit layer id. Defaults to Layer III. */
  readonly layerId?: number;
  /** Bitrate in kbit/s; ignored when `bitrateIndex` is given. */
  readonly bitrateKbps?: number;
  /** Raw 4-bit bitrate index, for invalid-value tests. */
  readonly bitrateIndex?: number;
  /** Sample rate in Hz; ignored when `sampleRateIndex` is given. */
  readonly sampleRateHz?: number;
  /** Raw 2-bit sample rate index, for invalid-value tests. */
  readonly sampleRateIndex?: number;
  readonly padding?: boolean;
  /** When true the protection bit is cleared, meaning "CRC present". */
  readonly crc?: boolean;
  /** Raw 2-bit channel mode. Defaults to joint stereo. */
  readonly channelMode?: number;
  readonly modeExtension?: number;
  readonly copyright?: boolean;
  readonly original?: boolean;
  /** Raw 2-bit emphasis. Defaults to 0b00 (none). */
  readonly emphasis?: number;
  readonly privateBit?: boolean;
  /** Byte used to fill the frame payload. Defaults to 0x00. */
  readonly fillByte?: number;
}

const DEFAULTS = {
  versionId: MpegVersionId.Mpeg1,
  layerId: MpegLayerId.Layer3,
  bitrateKbps: 128,
  sampleRateHz: 44_100,
  padding: false,
  crc: false,
  channelMode: ChannelMode.JointStereo,
  modeExtension: 0b00,
  copyright: false,
  original: true,
  emphasis: 0b00,
  privateBit: false,
  fillByte: 0x00,
} as const;

function resolveBitrateIndex(spec: FrameSpec): number {
  if (spec.bitrateIndex !== undefined) {
    return spec.bitrateIndex;
  }
  const kbps = spec.bitrateKbps ?? DEFAULTS.bitrateKbps;
  const index = BITRATE_INDEX_BY_KBPS.get(kbps);
  if (index === undefined) {
    throw new Error(`Test builder: ${kbps} kbit/s is not an MPEG-1 Layer III bitrate`);
  }
  return index;
}

function resolveSampleRateIndex(spec: FrameSpec): number {
  if (spec.sampleRateIndex !== undefined) {
    return spec.sampleRateIndex;
  }
  const hz = spec.sampleRateHz ?? DEFAULTS.sampleRateHz;
  const index = SAMPLE_RATE_INDEX_BY_HZ.get(hz);
  if (index === undefined) {
    throw new Error(`Test builder: ${hz} Hz is not an MPEG-1 sampling rate`);
  }
  return index;
}

/** Build the 4 header bytes for `spec`, including deliberately invalid ones. */
export function buildFrameHeaderBytes(spec: FrameSpec = {}): Buffer {
  const versionId = spec.versionId ?? DEFAULTS.versionId;
  const layerId = spec.layerId ?? DEFAULTS.layerId;
  const bitrateIndex = resolveBitrateIndex(spec);
  const sampleRateIndex = resolveSampleRateIndex(spec);
  const padding = spec.padding ?? DEFAULTS.padding;
  const crc = spec.crc ?? DEFAULTS.crc;
  const channelMode = spec.channelMode ?? DEFAULTS.channelMode;
  const modeExtension = spec.modeExtension ?? DEFAULTS.modeExtension;
  const copyright = spec.copyright ?? DEFAULTS.copyright;
  const original = spec.original ?? DEFAULTS.original;
  const emphasis = spec.emphasis ?? DEFAULTS.emphasis;
  const privateBit = spec.privateBit ?? DEFAULTS.privateBit;

  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = 0b1110_0000 | (versionId << 3) | (layerId << 1) | (crc ? 0 : 1);
  header[2] =
    (bitrateIndex << 4) | (sampleRateIndex << 2) | ((padding ? 1 : 0) << 1) | (privateBit ? 1 : 0);
  header[3] =
    (channelMode << 6) |
    (modeExtension << 4) |
    ((copyright ? 1 : 0) << 3) |
    ((original ? 1 : 0) << 2) |
    emphasis;
  return header;
}

/**
 * Expected MPEG-1 Layer III frame length, computed here independently of the
 * implementation so the tests assert against the specification, not against the
 * production code's own arithmetic.
 */
export function expectedFrameLength(
  bitrateKbps: number,
  sampleRateHz: number,
  padding: boolean,
): number {
  return Math.floor((144 * bitrateKbps * 1000) / sampleRateHz) + (padding ? 1 : 0);
}

/** Build one complete frame: header plus a payload of `fillByte`s. */
export function buildFrame(spec: FrameSpec = {}): Buffer {
  const header = buildFrameHeaderBytes(spec);
  const bitrateKbps = spec.bitrateKbps ?? DEFAULTS.bitrateKbps;
  const sampleRateHz = spec.sampleRateHz ?? DEFAULTS.sampleRateHz;
  const padding = spec.padding ?? DEFAULTS.padding;
  const length = expectedFrameLength(bitrateKbps, sampleRateHz, padding);
  const body = Buffer.alloc(length - header.length, spec.fillByte ?? DEFAULTS.fillByte);
  return Buffer.concat([header, body]);
}

/** Build `count` identical frames. */
export function buildFrames(count: number, spec: FrameSpec = {}): Buffer {
  return Buffer.concat(Array.from({ length: count }, () => buildFrame(spec)));
}

/** Build a stream from a list of per-frame specs. */
export function buildStream(specs: readonly FrameSpec[]): Buffer {
  return Buffer.concat(specs.map((spec) => buildFrame(spec)));
}

/* --- Metadata builders ---------------------------------------------------- */

function toSyncsafe(size: number): Buffer {
  const out = Buffer.alloc(4);
  out[0] = (size >> 21) & 0x7f;
  out[1] = (size >> 14) & 0x7f;
  out[2] = (size >> 7) & 0x7f;
  out[3] = size & 0x7f;
  return out;
}

export interface Id3v2Options {
  /** Size of the tag body in bytes. */
  bodyBytes?: number;
  /** Byte used to fill the tag body — 0xff exercises "metadata looks like sync". */
  fillByte?: number;
  /** Emit the ID3v2.4 footer (and set the corresponding flag). */
  withFooter?: boolean;
  /** Write a non-syncsafe size, for malformed-tag tests. */
  malformedSize?: boolean;
}

export function buildId3v2Tag(options: Id3v2Options = {}): Buffer {
  const bodyBytes = options.bodyBytes ?? 64;
  const withFooter = options.withFooter ?? false;

  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'latin1');
  header[3] = withFooter ? 4 : 3; // major version
  header[4] = 0; // revision
  header[5] = withFooter ? 0b0001_0000 : 0;
  const size = options.malformedSize === true ? Buffer.from([0xff, 0xff, 0xff, 0xff]) : toSyncsafe(bodyBytes);
  size.copy(header, 6);

  const body = Buffer.alloc(bodyBytes, options.fillByte ?? 0x00);

  if (!withFooter) {
    return Buffer.concat([header, body]);
  }

  const footer = Buffer.alloc(10);
  footer.write('3DI', 0, 'latin1');
  header.copy(footer, 3, 3, 10);
  return Buffer.concat([header, body, footer]);
}

/** A 128-byte ID3v1 tag. */
export function buildId3v1Tag(title = 'test title'): Buffer {
  const tag = Buffer.alloc(128, 0x00);
  tag.write('TAG', 0, 'latin1');
  tag.write(title.slice(0, 30), 3, 'latin1');
  return tag;
}

/** A 227-byte ID3v1 extended tag, which precedes the ID3v1 tag. */
export function buildId3v1ExtendedTag(): Buffer {
  const tag = Buffer.alloc(227, 0x00);
  tag.write('TAG+', 0, 'latin1');
  return tag;
}

/** An APEv2 tag consisting of header + body + footer. */
export function buildApev2Tag(bodyBytes = 48): Buffer {
  const makeBlock = (isHeader: boolean): Buffer => {
    const block = Buffer.alloc(32, 0x00);
    block.write('APETAGEX', 0, 'latin1');
    block.writeUInt32LE(2000, 8); // version
    block.writeUInt32LE(bodyBytes + 32, 12); // size: body + footer
    block.writeUInt32LE(1, 16); // item count
    // bit 31 = "this tag contains a header"; bit 29 = "this block is the header"
    block.writeUInt32LE(isHeader ? 0xa000_0000 : 0x8000_0000, 20);
    return block;
  };
  return Buffer.concat([makeBlock(true), Buffer.alloc(bodyBytes, 0x41), makeBlock(false)]);
}
