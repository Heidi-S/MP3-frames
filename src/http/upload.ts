/**
 * Multipart upload middleware.
 *
 * multer is used purely as infrastructure: it parses `multipart/form-data` and
 * hands us a `Buffer`. It performs no MP3 inspection of any kind.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';

import { MAX_UPLOAD_BYTES, UPLOAD_FIELD_NAME } from './config.js';
import { HTTP_STATUS, HttpError } from './errors.js';

const MAX_NON_FILE_FIELDS = 8;

const upload = multer({
  // In-memory storage: the parser needs random access to the full buffer and
  // uploads are capped at MAX_UPLOAD_BYTES. No temporary files are created.
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: MAX_NON_FILE_FIELDS,
  },
});

const singleFile = upload.single(UPLOAD_FIELD_NAME);

/** Translate multer's own errors into our HTTP error shape. */
function toHttpError(error: unknown): HttpError {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return new HttpError(
          HTTP_STATUS.payloadTooLarge,
          'FILE_TOO_LARGE',
          `Uploaded file exceeds the maximum size of ${MAX_UPLOAD_BYTES} bytes.`,
        );
      case 'LIMIT_UNEXPECTED_FILE':
        return new HttpError(
          HTTP_STATUS.badRequest,
          'UNEXPECTED_FIELD',
          `Unexpected file field "${error.field ?? ''}". The file must be sent in the "${UPLOAD_FIELD_NAME}" field.`,
        );
      case 'LIMIT_FILE_COUNT':
        return new HttpError(
          HTTP_STATUS.badRequest,
          'TOO_MANY_FILES',
          'Exactly one file must be uploaded.',
        );
      default:
        return new HttpError(
          HTTP_STATUS.badRequest,
          'INVALID_MULTIPART_REQUEST',
          'The multipart/form-data request could not be processed.',
        );
    }
  }

  return new HttpError(
    HTTP_STATUS.badRequest,
    'INVALID_MULTIPART_REQUEST',
    'The request body must be a valid multipart/form-data upload.',
  );
}

/**
 * Accepts a single file in the `file` field and guarantees that `req.file`
 * exists and is non-empty by the time the route handler runs.
 */
export const uploadSingleMp3: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  singleFile(req, res, (error: unknown) => {
    if (error !== undefined && error !== null) {
      next(toHttpError(error));
      return;
    }

    if (req.file === undefined) {
      next(
        new HttpError(
          HTTP_STATUS.badRequest,
          'MISSING_FILE',
          `No file was uploaded. Send the MP3 as multipart/form-data in the "${UPLOAD_FIELD_NAME}" field.`,
        ),
      );
      return;
    }

    if (req.file.buffer.length === 0) {
      next(new HttpError(HTTP_STATUS.badRequest, 'EMPTY_FILE', 'The uploaded file is empty.'));
      return;
    }

    next();
  });
};
