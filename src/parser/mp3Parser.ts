/**
 * MPEG-1 Layer III frame traversal and counting.
 *
 * Strategy
 * --------
 * The parser is deterministic and never scans for sync words. It establishes
 * the audio region from the file's metadata structure, then walks it frame by
 * frame:
 *
 *   1. read the 4-byte header at the current offset
 *   2. validate sync / version / layer / bitrate / sample rate / emphasis
 *   3. calculate the frame length from bitrate, sample rate and padding
 *   4. verify the whole frame fits inside the audio region
 *   5. advance by exactly that length and repeat
 *
 * Because step 5 lands precisely on the next header, a `FF Ex` byte pair that
 * happens to occur inside a frame's payload is never mistaken for a frame. The
 * converse is also true: if the stream is corrupt, the offset after a frame
 * will not hold a valid header and the parse fails loudly instead of
 * resynchronising and producing a plausible-looking but wrong number.
 *
 * Cross-frame consistency (sample rate) is enforced as well; bitrate is allowed
 * to change because variable bitrate encoding is normal and legal.
 */

import { FRAME_HEADER_BYTES } from "./constants.js";
import { Mp3ParseError } from "./errors.js";
import { readFrameHeader, type Mpeg1Layer3FrameHeader } from "./frameHeader.js";
import { findAudioEndOffset, readId3v2TagLength } from "./id3.js";

export interface Mp3AnalysisResult {
  /** Number of complete, validated MPEG-1 Layer III frames in the stream. */
  readonly frameCount: number;
  /** Offset at which the MPEG audio stream begins (after any ID3v2 tag). */
  readonly audioStartOffset: number;
  /** Exclusive offset at which the MPEG audio stream ends (before trailing tags). */
  readonly audioEndOffset: number;
  /** Header of the first frame — useful for diagnostics and tests. */
  readonly firstFrame: Mpeg1Layer3FrameHeader;
}

/**
 * Parse `data` and return the number of MPEG-1 Layer III frames it contains.
 *
 * @throws {Mp3ParseError} for empty input, unsupported MPEG formats, malformed
 *   headers, truncated frames, inconsistent streams, or any trailing bytes that
 *   are neither a complete frame nor recognised metadata.
 */
export function countMpeg1Layer3Frames(data: Buffer): Mp3AnalysisResult {
  if (data.length === 0) {
    throw new Mp3ParseError("EMPTY_FILE", "The uploaded file is empty.");
  }

  const audioStartOffset = readId3v2TagLength(data);
  const audioEndOffset = findAudioEndOffset(data, audioStartOffset);
  const audioLength = audioEndOffset - audioStartOffset;

  if (audioLength <= 0) {
    throw new Mp3ParseError(
      "NO_AUDIO_DATA",
      "The file contains metadata but no MPEG audio data.",
      { offset: audioStartOffset },
    );
  }
  if (audioLength < FRAME_HEADER_BYTES) {
    throw new Mp3ParseError(
      "FILE_TOO_SMALL",
      `The file is too small to contain an MPEG audio frame (${audioLength} audio byte(s)).`,
      { offset: audioStartOffset },
    );
  }

  let offset = audioStartOffset;
  let frameCount = 0;
  let firstFrame: Mpeg1Layer3FrameHeader | undefined;
  let expectedSampleRateHz: number | undefined;

  while (offset < audioEndOffset) {
    const bytesRemaining = audioEndOffset - offset;

    if (bytesRemaining < FRAME_HEADER_BYTES) {
      throw new Mp3ParseError(
        "TRUNCATED_FRAME",
        `Incomplete MPEG frame header at byte offset ${offset}: only ${bytesRemaining} byte(s) remain.`,
        { offset, framesParsed: frameCount },
      );
    }

    const header = readFrameHeader(data, offset);

    if (expectedSampleRateHz === undefined) {
      expectedSampleRateHz = header.sampleRateHz;
    } else if (header.sampleRateHz !== expectedSampleRateHz) {
      // A real MPEG-1 Layer III stream keeps a constant sampling rate; a change
      // means we are no longer aligned with genuine frame boundaries.
      throw new Mp3ParseError(
        "INCONSISTENT_STREAM",
        `Sampling rate changed from ${expectedSampleRateHz} Hz to ${header.sampleRateHz} Hz at byte offset ${offset}.`,
        { offset, framesParsed: frameCount },
      );
    }

    if (header.frameLengthBytes > bytesRemaining) {
      throw new Mp3ParseError(
        "TRUNCATED_FRAME",
        `Frame at byte offset ${offset} declares ${header.frameLengthBytes} bytes but only ${bytesRemaining} byte(s) remain.`,
        { offset, framesParsed: frameCount },
      );
    }

    if (firstFrame === undefined) {
      firstFrame = header;
    }

    offset += header.frameLengthBytes;
    frameCount += 1;
  }

  if (firstFrame === undefined || frameCount === 0) {
    throw new Mp3ParseError(
      "NO_AUDIO_FRAMES",
      "No MPEG-1 Layer III audio frames were found in the file.",
      { offset: audioStartOffset },
    );
  }

  return { frameCount, audioStartOffset, audioEndOffset, firstFrame };
}
