import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { MAX_UPLOAD_BYTES } from "../src/http/config.js";
import type { HttpErrorCode } from "../src/http/errors.js";
import type { FrameCountResponseBody } from "../src/http/routes/fileUpload.js";
import {
  buildFrame,
  buildFrames,
  buildId3v1Tag,
  buildId3v2Tag,
  buildStream,
} from "./helpers/mp3Builder.js";

const app = createApp();
const ENDPOINT = "/file-upload";

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(here, "..", "samples");

/**
 * `samples/sample.mp3` is real LAME output (5 s sine, 128 kbit/s, 44.1 kHz,
 * ID3v2 + ID3v1 + a Xing/LAME header frame). ffprobe reports 193 audio packets
 * for it; we report 194 because the Xing header frame is itself a structurally
 * valid MPEG-1 Layer III frame and is counted. See the README.
 */
const REAL_SAMPLE_FRAME_COUNT = 194;

/** `samples/generated-sample.mp3` is built by scripts/generate-sample.ts. */
const GENERATED_SAMPLE_FRAME_COUNT = 500;

describe("POST /file-upload — success", () => {
  it("returns 200, JSON, and exactly { frameCount } for a valid upload", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", buildFrames(42), "audio.mp3");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body).toEqual({ frameCount: 42 });

    const body: unknown = response.body;
    expect(isFrameCountBody(body)).toBe(true);
    if (isFrameCountBody(body)) {
      expect(Object.keys(body)).toEqual(["frameCount"]);
    }
  });

  it("returns the exact frame count for a single frame", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", buildFrame(), "one.mp3");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ frameCount: 1 });
  });

  it("returns the exact frame count for a variable-bitrate stream", async () => {
    const specs = [
      { bitrateKbps: 320 },
      { bitrateKbps: 128, padding: true },
      { bitrateKbps: 64 },
      { bitrateKbps: 192 },
    ];
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", buildStream(specs), "vbr.mp3");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ frameCount: specs.length });
  });

  it("excludes ID3v2 and ID3v1 metadata from the count", async () => {
    const data = Buffer.concat([
      buildId3v2Tag({ bodyBytes: 4096, fillByte: 0xff }),
      buildFrames(30),
      buildId3v1Tag(),
    ]);
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", data, "tagged.mp3");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ frameCount: 30 });
  });

  it("ignores the filename extension and the client Content-Type", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", buildFrames(9), {
        filename: "not-an-mp3.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ frameCount: 9 });
  });
});

describe("POST /file-upload — end-to-end with sample files", () => {
  it("reports the known frame count of the real encoder-produced sample", async () => {
    const sample = readFileSync(join(samplesDir, "sample.mp3"));

    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", sample, "sample.mp3");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ frameCount: REAL_SAMPLE_FRAME_COUNT });
  });

  it("reports the known frame count of the generated sample", async () => {
    const sample = readFileSync(join(samplesDir, "generated-sample.mp3"));

    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", sample, "generated.mp3");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ frameCount: GENERATED_SAMPLE_FRAME_COUNT });
  });
});

describe("POST /file-upload — client errors", () => {
  const expectJsonError = (
    response: request.Response,
    status: number,
    code: HttpErrorCode,
  ): void => {
    expect(response.status).toBe(status);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body).toEqual({
      error: { code, message: expect.any(String) },
    });
    expect(JSON.stringify(response.body)).not.toContain("at Object.");
  };

  it("rejects a request with no file part", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .field("name", "no file here");

    expectJsonError(response, 400, "MISSING_FILE");
  });

  it("rejects a request that is not multipart/form-data", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .set("Content-Type", "application/octet-stream")
      .send(buildFrames(3));

    expectJsonError(response, 400, "MISSING_FILE");
  });

  it("rejects a file sent under the wrong field name", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach("audio", buildFrames(3), "audio.mp3");

    expectJsonError(response, 400, "UNEXPECTED_FIELD");
  });

  it("rejects an empty upload", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", Buffer.alloc(0), "empty.mp3");

    expectJsonError(response, 400, "EMPTY_FILE");
  });

  it("rejects a file that is not an MP3 at all", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach(
        "file",
        Buffer.from("plain text pretending to be audio"),
        "song.mp3",
      );

    expectJsonError(response, 422, "INVALID_SYNC");
  });

  it("rejects MPEG Version 2 audio", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", buildFrames(4, { versionId: 0b10 }), "mpeg2.mp3");

    expectJsonError(response, 422, "UNSUPPORTED_MPEG_VERSION");
  });

  it("rejects MPEG Version 2.5 audio", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", buildFrames(4, { versionId: 0b00 }), "mpeg25.mp3");

    expectJsonError(response, 422, "UNSUPPORTED_MPEG_VERSION");
  });

  it("rejects Layer II audio", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", buildFrames(4, { layerId: 0b10 }), "layer2.mp3");

    expectJsonError(response, 422, "UNSUPPORTED_LAYER");
  });

  it("rejects a reserved bitrate index", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", buildFrame({ bitrateIndex: 0b1111 }), "bad-bitrate.mp3");

    expectJsonError(response, 422, "RESERVED_BITRATE");
  });

  it("rejects a reserved sampling rate index", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach(
        "file",
        buildFrame({ sampleRateIndex: 0b11 }),
        "bad-samplerate.mp3",
      );

    expectJsonError(response, 422, "RESERVED_SAMPLE_RATE");
  });

  it("rejects a truncated frame", async () => {
    const truncated = buildFrames(3).subarray(0, 3 * 417 - 50);
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", truncated, "cut.mp3");

    expectJsonError(response, 422, "TRUNCATED_FRAME");
  });

  it("rejects an upload larger than the configured limit", async () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1024, 0x00);
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", oversized, "huge.mp3");

    expectJsonError(response, 413, "FILE_TOO_LARGE");
  });
});

describe("routing", () => {
  it("returns a JSON 404 for unknown routes", async () => {
    const response = await request(app).get("/nope");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String) },
    });
  });

  it("does not expose the x-powered-by header", async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .attach("file", buildFrame(), "a.mp3");

    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});

function isFrameCountBody(body: unknown): body is FrameCountResponseBody {
  if (typeof body !== "object" || body === null || !("frameCount" in body)) {
    return false;
  }
  return Object.keys(body).length === 1 && typeof body.frameCount === "number";
}
