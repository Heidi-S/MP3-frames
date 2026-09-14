/**
 * MPEG-1 Layer III frame header decoding and frame-length calculation.
 *
 * This module is deliberately small and literal: every field is extracted with
 * a named mask/shift from `constants.ts`, validated against a lookup table, and
 * rejected with a specific error code. Nothing here scans, guesses or recovers
 * — that policy lives in `mp3Parser.ts`.
 */

import {
  BITRATE_INDEX_MASK,
  BITRATE_INDEX_SHIFT,
  BITS_PER_KILOBIT,
  CHANNEL_MODE_MASK,
  CHANNEL_MODE_SHIFT,
  EMPHASIS_MASK,
  FRAME_HEADER_BYTES,
  FREE_FORMAT_BITRATE_INDEX,
  LAYER_MASK,
  LAYER_SHIFT,
  MPEG1_LAYER3_FRAME_LENGTH_COEFFICIENT,
  MPEG1_LAYER3_SLOT_BYTES,
  MpegLayerId,
  MpegVersionId,
  PADDING_MASK,
  PADDING_SHIFT,
  PROTECTION_MASK,
  RESERVED_BITRATE_INDEX,
  RESERVED_EMPHASIS,
  RESERVED_SAMPLE_RATE_INDEX,
  SAMPLE_RATE_INDEX_MASK,
  SAMPLE_RATE_INDEX_SHIFT,
  SUPPORTED_LAYER_ID,
  SUPPORTED_VERSION_ID,
  SYNC_BYTE_0,
  SYNC_BYTE_1_MASK,
  SYNC_BYTE_1_VALUE,
  VERSION_MASK,
  VERSION_SHIFT,
  channelModeFromBits,
  mpeg1Layer3BitrateKbps,
  mpeg1SampleRateHz,
  type ChannelMode,
} from "./constants.js";
import { Mp3ParseError } from "./errors.js";

/** A fully validated MPEG-1 Layer III frame header. */
export interface Mpeg1Layer3FrameHeader {
  /** Byte offset of the header within the buffer it was read from. */
  readonly offset: number;
  readonly bitrateKbps: number;
  readonly sampleRateHz: number;
  readonly hasPadding: boolean;
  /** True when a 16-bit CRC follows the header (protection bit == 0). */
  readonly hasCrc: boolean;
  readonly channelMode: ChannelMode;
  /** Total frame size in bytes, header (and CRC, if present) included. */
  readonly frameLengthBytes: number;
}

/**
 * Frame length for MPEG-1 Layer III.
 *
 *   samples per frame = 1152 (fixed for MPEG-1 Layer III)
 *   bytes of audio per second = bitrate_bits_per_second / 8
 *   frame duration in seconds = 1152 / sampleRate
 *
 * therefore
 *
 *   frameLength = floor( (1152 / 8) * bitrate_bps / sampleRate ) + paddingSlot
 *               = floor( 144 * bitrate_kbps * 1000 / sampleRate ) + paddingSlot
 *
 * The floor is what makes padding necessary: 1152 samples rarely divide into a
 * whole number of bytes, so the encoder sets the padding bit on some frames to
 * add one extra slot and keep the average bitrate exact. In Layer III a slot is
 * one byte.
 *
 * The optional 16-bit CRC is *inside* this length, so no adjustment is needed.
 */
export function calculateFrameLengthBytes(
  bitrateKbps: number,
  sampleRateHz: number,
  hasPadding: boolean,
): number {
  const base = Math.floor(
    (MPEG1_LAYER3_FRAME_LENGTH_COEFFICIENT * bitrateKbps * BITS_PER_KILOBIT) /
      sampleRateHz,
  );
  return base + (hasPadding ? MPEG1_LAYER3_SLOT_BYTES : 0);
}

/**
 * Decode and validate the 4-byte frame header at `offset`.
 *
 * Throws `Mp3ParseError` with a precise code for every invalid or unsupported
 * field. The caller must guarantee that at least `FRAME_HEADER_BYTES` bytes are
 * available; `readFrameHeader` checks this too and reports `TRUNCATED_FRAME`.
 */
export function readFrameHeader(
  data: Buffer,
  offset: number,
): Mpeg1Layer3FrameHeader {
  if (offset < 0 || offset + FRAME_HEADER_BYTES > data.length) {
    throw new Mp3ParseError(
      "TRUNCATED_FRAME",
      `Incomplete MPEG frame header at byte offset ${offset}: fewer than ${FRAME_HEADER_BYTES} bytes remain.`,
      { offset },
    );
  }

  const byte0 = data.readUInt8(offset);
  const byte1 = data.readUInt8(offset + 1);
  const byte2 = data.readUInt8(offset + 2);
  const byte3 = data.readUInt8(offset + 3);

  // 1. Frame sync: 11 bits, all set.
  if (
    byte0 !== SYNC_BYTE_0 ||
    (byte1 & SYNC_BYTE_1_MASK) !== SYNC_BYTE_1_VALUE
  ) {
    throw new Mp3ParseError(
      "INVALID_SYNC",
      `Expected an MPEG frame sync word at byte offset ${offset}.`,
      { offset },
    );
  }

  // 2. MPEG version: only MPEG Version 1 is supported.
  const versionId = (byte1 & VERSION_MASK) >> VERSION_SHIFT;
  if (versionId === MpegVersionId.Reserved) {
    throw new Mp3ParseError(
      "RESERVED_MPEG_VERSION",
      `Reserved MPEG version id at byte offset ${offset}.`,
      { offset },
    );
  }
  if (versionId !== SUPPORTED_VERSION_ID) {
    throw new Mp3ParseError(
      "UNSUPPORTED_MPEG_VERSION",
      `${unsupportedMpegVersionLabel(versionId)} frame at byte offset ${offset}: only MPEG Version 1 is supported.`,
      { offset },
    );
  }

  // 3. Layer: only Layer III is supported.
  const layerId = (byte1 & LAYER_MASK) >> LAYER_SHIFT;
  if (layerId === MpegLayerId.Reserved) {
    throw new Mp3ParseError(
      "RESERVED_LAYER",
      `Reserved MPEG layer value at byte offset ${offset}.`,
      { offset },
    );
  }
  if (layerId !== SUPPORTED_LAYER_ID) {
    throw new Mp3ParseError(
      "UNSUPPORTED_LAYER",
      `MPEG ${unsupportedLayerLabel(layerId)} frame at byte offset ${offset}: only Layer III is supported.`,
      { offset },
    );
  }

  const hasCrc = (byte1 & PROTECTION_MASK) === 0;

  // 4. Bitrate index.
  const bitrateIndex = (byte2 & BITRATE_INDEX_MASK) >> BITRATE_INDEX_SHIFT;
  if (bitrateIndex === FREE_FORMAT_BITRATE_INDEX) {
    throw new Mp3ParseError(
      "FREE_FORMAT_BITRATE",
      `Free-format bitrate at byte offset ${offset}: frame length cannot be derived from the header.`,
      { offset },
    );
  }
  if (bitrateIndex === RESERVED_BITRATE_INDEX) {
    throw new Mp3ParseError(
      "RESERVED_BITRATE",
      `Reserved bitrate index at byte offset ${offset}.`,
      { offset },
    );
  }
  const bitrateKbps = mpeg1Layer3BitrateKbps(bitrateIndex);
  if (bitrateKbps === undefined) {
    throw new Mp3ParseError(
      "RESERVED_BITRATE",
      `Invalid bitrate index ${bitrateIndex} at byte offset ${offset}.`,
      { offset },
    );
  }

  // 5. Sampling rate index.
  const sampleRateIndex =
    (byte2 & SAMPLE_RATE_INDEX_MASK) >> SAMPLE_RATE_INDEX_SHIFT;
  if (sampleRateIndex === RESERVED_SAMPLE_RATE_INDEX) {
    throw new Mp3ParseError(
      "RESERVED_SAMPLE_RATE",
      `Reserved sampling rate index at byte offset ${offset}.`,
      { offset },
    );
  }
  const sampleRateHz = mpeg1SampleRateHz(sampleRateIndex);
  if (sampleRateHz === undefined) {
    throw new Mp3ParseError(
      "RESERVED_SAMPLE_RATE",
      `Invalid sampling rate index ${sampleRateIndex} at byte offset ${offset}.`,
      { offset },
    );
  }

  // 6. Padding bit.
  const hasPadding = (byte2 & PADDING_MASK) >> PADDING_SHIFT === 1;

  // 7. Emphasis: 0b10 is reserved, i.e. a malformed header.
  const emphasis = byte3 & EMPHASIS_MASK;
  if (emphasis === RESERVED_EMPHASIS) {
    throw new Mp3ParseError(
      "RESERVED_EMPHASIS",
      `Reserved emphasis value at byte offset ${offset}.`,
      { offset },
    );
  }

  const channelMode = channelModeFromBits(
    (byte3 & CHANNEL_MODE_MASK) >> CHANNEL_MODE_SHIFT,
  );
  if (channelMode === undefined) {
    throw new Error(
      `Unreachable: channel mode bits out of range at byte offset ${offset}.`,
    );
  }

  // 8. Frame length.
  const frameLengthBytes = calculateFrameLengthBytes(
    bitrateKbps,
    sampleRateHz,
    hasPadding,
  );

  // A frame must at least contain its own header. With the tables above the
  // smallest possible frame is 96 bytes (32 kbit/s at 48 kHz), so this is a
  // defensive invariant rather than a reachable branch.
  if (frameLengthBytes <= FRAME_HEADER_BYTES) {
    throw new Mp3ParseError(
      "TRUNCATED_FRAME",
      `Calculated frame length ${frameLengthBytes} at byte offset ${offset} is not a usable frame.`,
      { offset },
    );
  }

  return {
    offset,
    bitrateKbps,
    sampleRateHz,
    hasPadding,
    hasCrc,
    channelMode,
    frameLengthBytes,
  };
}

function unsupportedMpegVersionLabel(versionId: number): string {
  if (versionId === MpegVersionId.Mpeg2) {
    return "MPEG Version 2";
  }
  if (versionId === MpegVersionId.Mpeg2_5) {
    return "MPEG Version 2.5";
  }
  return `MPEG version id ${versionId}`;
}

function unsupportedLayerLabel(layerId: number): string {
  if (layerId === MpegLayerId.Layer1) {
    return "Layer I";
  }
  if (layerId === MpegLayerId.Layer2) {
    return "Layer II";
  }
  return `layer id ${layerId}`;
}
