/**
 * Shared Express middleware: 404 handling and the central error handler.
 */

import type { ErrorRequestHandler, RequestHandler } from 'express';

import { isMp3ParseError } from '../parser/index.js';
import {
  HTTP_STATUS,
  HttpError,
  statusForParseErrorCode,
  type ErrorResponseBody,
  type HttpErrorCode,
} from './errors.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  send(res.status(HTTP_STATUS.notFound), 'NOT_FOUND', 'The requested resource does not exist.');
};

/**
 * Converts every failure into the documented JSON error shape.
 *
 * Parser failures become 4xx responses with the parser's own code; anything
 * unexpected becomes a generic 500 with no internal detail leaked.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    send(res.status(error.status), error.code, error.message);
    return;
  }

  if (isMp3ParseError(error)) {
    send(res.status(statusForParseErrorCode(error.code)), error.code, error.message);
    return;
  }

  // Unknown failure: log server-side, return nothing revealing.
  console.error('Unhandled error while processing request:', error);
  send(
    res.status(HTTP_STATUS.internalServerError),
    'INTERNAL_ERROR',
    'An unexpected error occurred.',
  );
};

function send(
  res: { json: (body: ErrorResponseBody) => unknown },
  code: HttpErrorCode,
  message: string,
): void {
  res.json({ error: { code, message } });
}
