/**
 * Public surface of the MP3 parser.
 *
 * This module has no dependency on Express, HTTP, or the filesystem: it takes a
 * `Buffer` and returns numbers or throws `Mp3ParseError`.
 */

export { countMpeg1Layer3Frames, type Mp3AnalysisResult } from './mp3Parser.js';
export {
  calculateFrameLengthBytes,
  readFrameHeader,
  type Mpeg1Layer3FrameHeader,
} from './frameHeader.js';
export { findAudioEndOffset, readId3v2TagLength } from './id3.js';
export { Mp3ParseError, isMp3ParseError, type Mp3ParseErrorCode } from './errors.js';
export {
  ChannelMode,
  MPEG1_LAYER3_BITRATES_KBPS,
  MPEG1_SAMPLE_RATES_HZ,
  MpegLayerId,
  MpegVersionId,
} from './constants.js';
