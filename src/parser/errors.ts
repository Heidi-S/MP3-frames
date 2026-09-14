/**
 * Parser-specific error type.
 *
 * The parser never throws bare `Error`s for input problems: every rejection
 * carries a stable machine-readable code so the HTTP layer can map it to a
 * status and a client-safe message without inspecting error strings.
 */

export type Mp3ParseErrorCode =
  /* Input-level problems */
  | 'EMPTY_FILE'
  | 'FILE_TOO_SMALL'
  | 'MALFORMED_ID3V2'
  | 'NO_AUDIO_DATA'
  /* Header-level problems */
  | 'INVALID_SYNC'
  | 'RESERVED_MPEG_VERSION'
  | 'UNSUPPORTED_MPEG_VERSION'
  | 'RESERVED_LAYER'
  | 'UNSUPPORTED_LAYER'
  | 'FREE_FORMAT_BITRATE'
  | 'RESERVED_BITRATE'
  | 'RESERVED_SAMPLE_RATE'
  | 'RESERVED_EMPHASIS'
  /* Stream-level problems */
  | 'TRUNCATED_FRAME'
  | 'INCONSISTENT_STREAM'
  | 'NO_AUDIO_FRAMES';

export interface Mp3ParseErrorDetails {
  /** Byte offset in the uploaded file where the problem was detected. */
  readonly offset?: number;
  /** Number of frames successfully parsed before the failure. */
  readonly framesParsed?: number;
}

export class Mp3ParseError extends Error {
  public readonly code: Mp3ParseErrorCode;
  public readonly offset: number | undefined;
  public readonly framesParsed: number | undefined;

  public constructor(code: Mp3ParseErrorCode, message: string, details: Mp3ParseErrorDetails = {}) {
    super(message);
    this.name = 'Mp3ParseError';
    this.code = code;
    this.offset = details.offset;
    this.framesParsed = details.framesParsed;
    Error.captureStackTrace?.(this, Mp3ParseError);
  }
}

export function isMp3ParseError(error: unknown): error is Mp3ParseError {
  return error instanceof Mp3ParseError;
}
