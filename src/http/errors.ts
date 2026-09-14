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

import type { Mp3ParseErrorCode } from "../parser/index.js";

export type HttpErrorCode =
  | Mp3ParseErrorCode
  | "MISSING_FILE"
  | "UNEXPECTED_FIELD"
  | "TOO_MANY_FILES"
  | "FILE_TOO_LARGE"
  | "INVALID_MULTIPART_REQUEST"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

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
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    Error.captureStackTrace?.(this, HttpError);
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
 *
 * The map is keyed by every `Mp3ParseErrorCode` so a newly added parser code is
 * a compile-time error until it has an HTTP status.
 */
const PARSE_ERROR_HTTP_STATUS = {
  EMPTY_FILE: BAD_REQUEST,
  FILE_TOO_SMALL: UNPROCESSABLE_ENTITY,
  MALFORMED_ID3V2: UNPROCESSABLE_ENTITY,
  NO_AUDIO_DATA: UNPROCESSABLE_ENTITY,
  INVALID_SYNC: UNPROCESSABLE_ENTITY,
  RESERVED_MPEG_VERSION: UNPROCESSABLE_ENTITY,
  UNSUPPORTED_MPEG_VERSION: UNPROCESSABLE_ENTITY,
  RESERVED_LAYER: UNPROCESSABLE_ENTITY,
  UNSUPPORTED_LAYER: UNPROCESSABLE_ENTITY,
  FREE_FORMAT_BITRATE: UNPROCESSABLE_ENTITY,
  RESERVED_BITRATE: UNPROCESSABLE_ENTITY,
  RESERVED_SAMPLE_RATE: UNPROCESSABLE_ENTITY,
  RESERVED_EMPHASIS: UNPROCESSABLE_ENTITY,
  TRUNCATED_FRAME: UNPROCESSABLE_ENTITY,
  INCONSISTENT_STREAM: UNPROCESSABLE_ENTITY,
  NO_AUDIO_FRAMES: UNPROCESSABLE_ENTITY,
} as const satisfies Record<Mp3ParseErrorCode, number>;

export function statusForParseErrorCode(code: Mp3ParseErrorCode): number {
  return PARSE_ERROR_HTTP_STATUS[code];
}

export const HTTP_STATUS = {
  ok: 200,
  badRequest: BAD_REQUEST,
  notFound: 404,
  payloadTooLarge: PAYLOAD_TOO_LARGE,
  unprocessableEntity: UNPROCESSABLE_ENTITY,
  internalServerError: 500,
} as const;
