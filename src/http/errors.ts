/**
 * HTTP error shape and the mapping from parser error codes to status codes.
 *
 * Error responses use:
 *
 *   { "error": { "code": "TRUNCATED_FRAME", "message": "..." } }
 *
 * `code` is stable and machine-readable; `message` is a short human-readable
 * explanation. Stack traces and internal details are never serialised.
 */

import type { Mp3ParseErrorCode } from '../parser/index.js';

export type HttpErrorCode =
  | Mp3ParseErrorCode
  | 'MISSING_FILE'
  | 'UNEXPECTED_FIELD'
  | 'TOO_MANY_FILES'
  | 'FILE_TOO_LARGE'
  | 'INVALID_MULTIPART_REQUEST'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export interface ErrorResponseBody {
  readonly error: {
    readonly code: HttpErrorCode;
    readonly message: string;
  };
}

/** An error that carries the HTTP status and client-safe payload with it. */
export class HttpError extends Error {
  public readonly status: number;
  public readonly code: HttpErrorCode;

  public constructor(status: number, code: HttpErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

const PAYLOAD_TOO_LARGE = 413;
const BAD_REQUEST = 400;
const UNPROCESSABLE_ENTITY = 422;

/**
 * Status code for each parser failure.
 *
 * Everything the parser rejects is a problem with the bytes the client sent, so
 * all of these are 4xx. Requests that are well-formed HTTP but carry a file we
 * cannot interpret as MPEG-1 Layer III audio are reported as 422 Unprocessable
 * Content; problems with the request itself (nothing uploaded, empty upload)
 * are 400.
 */
export function statusForParseErrorCode(code: Mp3ParseErrorCode): number {
  switch (code) {
    case 'EMPTY_FILE':
      return BAD_REQUEST;
    case 'FILE_TOO_SMALL':
    case 'MALFORMED_ID3V2':
    case 'NO_AUDIO_DATA':
    case 'INVALID_SYNC':
    case 'RESERVED_MPEG_VERSION':
    case 'UNSUPPORTED_MPEG_VERSION':
    case 'RESERVED_LAYER':
    case 'UNSUPPORTED_LAYER':
    case 'FREE_FORMAT_BITRATE':
    case 'RESERVED_BITRATE':
    case 'RESERVED_SAMPLE_RATE':
    case 'RESERVED_EMPHASIS':
    case 'TRUNCATED_FRAME':
    case 'INCONSISTENT_STREAM':
    case 'NO_AUDIO_FRAMES':
      return UNPROCESSABLE_ENTITY;
    default:
      return BAD_REQUEST;
  }
}

export const HTTP_STATUS = {
  ok: 200,
  badRequest: BAD_REQUEST,
  notFound: 404,
  payloadTooLarge: PAYLOAD_TOO_LARGE,
  unprocessableEntity: UNPROCESSABLE_ENTITY,
  internalServerError: 500,
} as const;
