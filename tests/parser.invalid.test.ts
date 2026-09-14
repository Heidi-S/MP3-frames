import { describe, expect, it } from 'vitest';

import {
  Mp3ParseError,
  countMpeg1Layer3Frames,
  type Mp3ParseErrorCode,
} from '../src/parser/index.js';
import {
  buildFrame,
  buildFrameHeaderBytes,
  buildFrames,
  buildId3v2Tag,
  buildStream,
} from './helpers/mp3Builder.js';

/** Assert that parsing `data` fails with a specific parser error code. */
function expectParseErrorCode(data: Buffer, code: Mp3ParseErrorCode): Mp3ParseError {
  let thrown: unknown;
  try {
    countMpeg1Layer3Frames(data);
  } catch (error: unknown) {
    thrown = error;
  }

  expect(thrown, `expected ${code} but parsing succeeded`).toBeInstanceOf(Mp3ParseError);
  const parseError = thrown as Mp3ParseError;
  expect(parseError.code).toBe(code);
  return parseError;
}

describe('input-level rejection', () => {
  it('rejects an empty file', () => {
    expectParseErrorCode(Buffer.alloc(0), 'EMPTY_FILE');
  });

  it('rejects a file containing no MPEG audio at all', () => {
    expectParseErrorCode(Buffer.from('this is a plain text file, not audio', 'utf8'), 'INVALID_SYNC');
  });

  it('rejects a file that is only ID3v2 metadata', () => {
    expectParseErrorCode(buildId3v2Tag({ bodyBytes: 512 }), 'NO_AUDIO_DATA');
  });

  it('rejects a file smaller than one frame header', () => {
    expectParseErrorCode(Buffer.from([0xff, 0xfb]), 'FILE_TOO_SMALL');
  });

  it('rejects an ID3v2 tag with a non-syncsafe size field', () => {
    const data = Buffer.concat([buildId3v2Tag({ malformedSize: true }), buildFrame()]);
    expectParseErrorCode(data, 'MALFORMED_ID3V2');
  });

  it('rejects an ID3v2 tag larger than the file', () => {
    const tag = buildId3v2Tag({ bodyBytes: 100_000 }).subarray(0, 200);
    expectParseErrorCode(tag, 'MALFORMED_ID3V2');
  });
});

describe('header-level rejection', () => {
  it('rejects a malformed sync word', () => {
    const frame = buildFrame();
    frame[1] = 0b1100_0000 | (frame[1]! & 0b0001_1111); // break the 11-bit sync
    expectParseErrorCode(frame, 'INVALID_SYNC');
  });

  it('rejects a reserved MPEG version id', () => {
    expectParseErrorCode(buildFrame({ versionId: 0b01 }), 'RESERVED_MPEG_VERSION');
  });

  it('rejects MPEG Version 2', () => {
    const error = expectParseErrorCode(buildFrame({ versionId: 0b10 }), 'UNSUPPORTED_MPEG_VERSION');
    expect(error.message).toContain('MPEG Version 2');
  });

  it('rejects MPEG Version 2.5', () => {
    const error = expectParseErrorCode(buildFrame({ versionId: 0b00 }), 'UNSUPPORTED_MPEG_VERSION');
    expect(error.message).toContain('MPEG Version 2.5');
  });

  it('rejects a reserved layer value', () => {
    expectParseErrorCode(buildFrame({ layerId: 0b00 }), 'RESERVED_LAYER');
  });

  it('rejects MPEG Layer I', () => {
    const error = expectParseErrorCode(buildFrame({ layerId: 0b11 }), 'UNSUPPORTED_LAYER');
    expect(error.message).toContain('Layer I');
  });

  it('rejects MPEG Layer II', () => {
    const error = expectParseErrorCode(buildFrame({ layerId: 0b10 }), 'UNSUPPORTED_LAYER');
    expect(error.message).toContain('Layer II');
  });

  it('rejects the free-format bitrate index', () => {
    expectParseErrorCode(buildFrame({ bitrateIndex: 0 }), 'FREE_FORMAT_BITRATE');
  });

  it('rejects the reserved bitrate index', () => {
    expectParseErrorCode(buildFrame({ bitrateIndex: 0b1111 }), 'RESERVED_BITRATE');
  });

  it('rejects the reserved sampling rate index', () => {
    expectParseErrorCode(buildFrame({ sampleRateIndex: 0b11 }), 'RESERVED_SAMPLE_RATE');
  });

  it('rejects the reserved emphasis value', () => {
    expectParseErrorCode(buildFrame({ emphasis: 0b10 }), 'RESERVED_EMPHASIS');
  });

  it('rejects an invalid header that appears after several valid frames', () => {
    const data = Buffer.concat([buildFrames(4), buildFrame({ layerId: 0b11 })]);
    const error = expectParseErrorCode(data, 'UNSUPPORTED_LAYER');

    expect(error.offset).toBe(4 * 417);
  });
});

describe('stream-level rejection', () => {
  it('rejects a truncated final frame', () => {
    const data = buildFrames(3).subarray(0, 3 * 417 - 20);
    const error = expectParseErrorCode(data, 'TRUNCATED_FRAME');

    expect(error.framesParsed).toBe(2);
  });

  it('rejects a trailing fragment shorter than a frame header', () => {
    const data = Buffer.concat([buildFrames(2), Buffer.from([0xff, 0xfb])]);
    expectParseErrorCode(data, 'TRUNCATED_FRAME');
  });

  it('rejects trailing bytes that are not audio or recognised metadata', () => {
    const data = Buffer.concat([buildFrames(2), Buffer.from('trailing junk data', 'utf8')]);
    expectParseErrorCode(data, 'INVALID_SYNC');
  });

  it('rejects a stream whose frame lengths do not line up with the next header', () => {
    // One stray byte between two otherwise valid frames: advancing by the
    // declared frame length no longer lands on a header.
    const data = Buffer.concat([buildFrame(), Buffer.from([0x00]), buildFrame()]);
    const error = expectParseErrorCode(data, 'INVALID_SYNC');

    expect(error.offset).toBe(417);
  });

  it('rejects a mid-stream sampling rate change', () => {
    const data = buildStream([
      { sampleRateHz: 44_100 },
      { sampleRateHz: 44_100 },
      { sampleRateHz: 48_000 },
    ]);
    const error = expectParseErrorCode(data, 'INCONSISTENT_STREAM');

    expect(error.framesParsed).toBe(2);
  });

  it('never returns a partial count when the stream becomes inconsistent', () => {
    const data = Buffer.concat([buildFrames(50), Buffer.from([0xff, 0xff, 0xff, 0xff])]);

    expect(() => countMpeg1Layer3Frames(data)).toThrow(Mp3ParseError);
  });

  it('rejects a lone valid header with no frame body', () => {
    expectParseErrorCode(buildFrameHeaderBytes(), 'TRUNCATED_FRAME');
  });
});
