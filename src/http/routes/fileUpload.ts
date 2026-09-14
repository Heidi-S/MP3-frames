/**
 * POST /file-upload
 *
 * Receives one MP3 as multipart/form-data (field name: `file`), hands the raw
 * bytes to the parser, and returns the frame count.
 *
 * Success response — exactly one property, as required by the API contract:
 *
 *   200 OK
 *   Content-Type: application/json
 *   { "frameCount": 12345 }
 */

import { ok as assert } from "node:assert/strict";

import { Router, type Request, type Response } from "express";

import { countMpeg1Layer3Frames } from "../../parser/index.js";
import { HTTP_STATUS } from "../errors.js";
import { uploadSingleMp3 } from "../upload.js";

export interface FrameCountResponseBody {
  readonly frameCount: number;
}

export const fileUploadRouter: Router = Router();

fileUploadRouter.post(
  "/file-upload",
  uploadSingleMp3,
  (req: Request, res: Response) => {
    const file = req.file;
    assert(
      file !== undefined,
      "upload middleware invariant violated: req.file is undefined",
    );

    // Note: neither the filename nor the client's Content-Type is consulted. Only
    // the bytes decide whether this is a valid MPEG-1 Layer III stream.
    const { frameCount } = countMpeg1Layer3Frames(file.buffer);

    const body: FrameCountResponseBody = { frameCount };
    res.status(HTTP_STATUS.ok).json(body);
  },
);
