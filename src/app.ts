/**
 * Express application factory.
 *
 * Kept free of `listen()` so tests can drive the app in-process with supertest.
 */

import express, { type Express } from 'express';

import { errorHandler, notFoundHandler } from './http/middleware.js';
import { fileUploadRouter } from './http/routes/fileUpload.js';

export function createApp(): Express {
  const app = express();

  // No JSON/urlencoded body parsers: the only endpoint takes multipart/form-data,
  // and leaving them out avoids buffering bodies we would never read.
  app.disable('x-powered-by');

  app.use(fileUploadRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
