/**
 * Shared Express middleware: 404 handling and the central error handler.
 */

import type { ErrorRequestHandler, RequestHandler, Response } from 'express';

import { isMp3ParseError } from '../parser/index.js';
import {
  HTTP_STATUS,
  HttpError,
  statusForParseErrorCode,
  type ErrorResponseBody,
  type HttpErrorCode,
} from './errors.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, HTTP_STATUS.notFound, 'NOT_FOUND', 'The requested resource does not exist.');
};

/**
 * Converts every failure into the documented JSON error shape.
 *
 * Parser failures become 4xx responses with the parser's own code; anything
 * unexpected becomes a generic 500 with no internal detail leaked.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  const failure: unknown = error;

  if (res.headersSent) {
    next(failure);
    return;
  }

  if (failure instanceof HttpError) {
    sendError(res, failure.status, failure.code, failure.message);
    return;
  }

  if (isMp3ParseError(failure)) {
    sendError(res, statusForParseErrorCode(failure.code), failure.code, failure.message);
    return;
  }

  // Unknown failure: log server-side, return nothing revealing.
  console.error('Unhandled error while processing request:', failure);
  sendError(
    res,
    HTTP_STATUS.internalServerError,
    'INTERNAL_ERROR',
    'An unexpected error occurred.',
  );
};

function sendError(res: Response, status: number, code: HttpErrorCode, message: string): void {
  const body: ErrorResponseBody = { error: { code, message } };
  res.status(status).json(body);
}
