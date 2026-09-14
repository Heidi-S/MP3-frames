/**
 * Constants and lookup tables for MPEG-1 Audio Layer III.
 *
 * Everything here is derived from the MPEG-1 audio specification (ISO/IEC
 * 11172-3). Only the values needed to locate and measure a frame are modelled;
 * nothing here decodes audio.
 *
 * ---------------------------------------------------------------------------
 * Frame header layout (4 bytes, big-endian bit order)
 * ---------------------------------------------------------------------------
 *
 *  byte 0    byte 1    byte 2    byte 3
 *  AAAAAAAA  AAABBCCD  EEEEFFGH  IIJJKLMM
 *
 *  A (11 bits) frame sync            — must be all 1s
 *  B (2 bits)  MPEG version id       — must be 0b11 (MPEG Version 1)
 *  C (2 bits)  layer description     — must be 0b01 (Layer III)
 *  D (1 bit)   protection bit        — 0 means a 16-bit CRC follows the header
 *  E (4 bits)  bitrate index         — table lookup, 0 = free, 15 = reserved
 *  F (2 bits)  sampling rate index   — table lookup, 3 = reserved
 *  G (1 bit)   padding bit           — 1 adds exactly one slot (1 byte in L3)
 *  H (1 bit)   private bit           — no effect on framing
 *  I (2 bits)  channel mode
 *  J (2 bits)  mode extension        — only meaningful for joint stereo
 *  K (1 bit)   copyright             — no effect on framing
 *  L (1 bit)   original              — no effect on framing
 *  M (2 bits)  emphasis              — 0b10 is reserved
 */

/** Size of the MPEG audio frame header in bytes. */
export const FRAME_HEADER_BYTES = 4;

/** Byte 0 of a valid header: the first 8 bits of the 11-bit sync word. */
export const SYNC_BYTE_0 = 0xff;

/** Mask/value for the remaining 3 sync bits, which live in the high bits of byte 1. */
export const SYNC_BYTE_1_MASK = 0b1110_0000;
export const SYNC_BYTE_1_VALUE = 0b1110_0000;

/* --- Header field extraction masks / shifts ------------------------------- */

export const VERSION_MASK = 0b0001_1000;
export const VERSION_SHIFT = 3;
export const LAYER_MASK = 0b0000_0110;
export const LAYER_SHIFT = 1;
export const PROTECTION_MASK = 0b0000_0001;

export const BITRATE_INDEX_MASK = 0b1111_0000;
export const BITRATE_INDEX_SHIFT = 4;
export const SAMPLE_RATE_INDEX_MASK = 0b0000_1100;
export const SAMPLE_RATE_INDEX_SHIFT = 2;
export const PADDING_MASK = 0b0000_0010;
export const PADDING_SHIFT = 1;

export const CHANNEL_MODE_MASK = 0b1100_0000;
export const CHANNEL_MODE_SHIFT = 6;
export const EMPHASIS_MASK = 0b0000_0011;

/* --- Version / layer identifiers ------------------------------------------ */

/** Raw 2-bit values of the MPEG version id field. */
export const MpegVersionId = {
  Mpeg2_5: 0b00,
  Reserved: 0b01,
  Mpeg2: 0b10,
  Mpeg1: 0b11,
} as const;

/** Raw 2-bit values of the layer description field. */
export const MpegLayerId = {
  Reserved: 0b00,
  Layer3: 0b01,
  Layer2: 0b10,
  Layer1: 0b11,
} as const;

/** The only version this application supports. */
export const SUPPORTED_VERSION_ID = MpegVersionId.Mpeg1;

/** The only layer this application supports. */
export const SUPPORTED_LAYER_ID = MpegLayerId.Layer3;

/* --- Bitrate / sample-rate tables ----------------------------------------- */

/**
 * MPEG-1 Layer III bitrates in kbit/s, indexed by the 4-bit bitrate index.
 *
 * Index 0 is "free format" (the bitrate is not described by the header, so the
 * frame length cannot be derived from the header alone) and index 15 is
 * reserved. Both are represented as `null` and rejected by the parser.
 */
export const MPEG1_LAYER3_BITRATES_KBPS: readonly (number | null)[] = [
  null, // 0  — free format (unsupported)
  32,
  40,
  48,
  56,
  64,
  80,
  96,
  112,
  128,
  160,
  192,
  224,
  256,
  320,
  null, // 15 — reserved (invalid)
] as const;

/** Bitrate index that means "free format". */
export const FREE_FORMAT_BITRATE_INDEX = 0;

/** Bitrate index reserved by the specification. */
export const RESERVED_BITRATE_INDEX = 15;

/**
 * MPEG-1 sampling rates in Hz, indexed by the 2-bit sampling rate index.
 * Index 3 is reserved and represented as `null`.
 */
export const MPEG1_SAMPLE_RATES_HZ: readonly (number | null)[] = [44_100, 48_000, 32_000, null] as const;

/** Sampling rate index reserved by the specification. */
export const RESERVED_SAMPLE_RATE_INDEX = 3;

/** Emphasis value reserved by the specification. */
export const RESERVED_EMPHASIS = 0b10;

/* --- Frame length arithmetic ---------------------------------------------- */

/** An MPEG-1 Layer III frame always carries exactly 1152 PCM samples per channel. */
export const MPEG1_LAYER3_SAMPLES_PER_FRAME = 1152;

export const BITS_PER_BYTE = 8;

/**
 * Layer III slot size is one byte, so the padding bit adds exactly 1 byte.
 * (In Layer I a slot is 4 bytes — one more reason this parser is version- and
 * layer-specific rather than generic.)
 */
export const MPEG1_LAYER3_SLOT_BYTES = 1;

/**
 * frameLength = (samplesPerFrame / 8) * bitrate / sampleRate  (+ padding slot)
 *
 * For MPEG-1 Layer III the constant factor is 1152 / 8 = 144.
 */
export const MPEG1_LAYER3_FRAME_LENGTH_COEFFICIENT =
  MPEG1_LAYER3_SAMPLES_PER_FRAME / BITS_PER_BYTE;

export const BITS_PER_KILOBIT = 1000;

/** Channel mode, kept for completeness / validation of decoded headers. */
export const ChannelMode = {
  Stereo: 0b00,
  JointStereo: 0b01,
  DualChannel: 0b10,
  Mono: 0b11,
} as const;

export type ChannelMode = (typeof ChannelMode)[keyof typeof ChannelMode];
