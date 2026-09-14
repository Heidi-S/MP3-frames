import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  countMpeg1Layer3Frames,
  readId3v2TagLength,
} from "../src/parser/index.js";
import {
  buildApev2Tag,
  buildFrame,
  buildFrames,
  buildId3v1ExtendedTag,
  buildId3v1Tag,
  buildId3v2Tag,
} from "./helpers/mp3Builder.js";

const FRAMES = 12;
const audio = (): Buffer => buildFrames(FRAMES);

describe("ID3v2 (leading metadata)", () => {
  it("reports 0 when there is no ID3v2 tag", () => {
    expect(readId3v2TagLength(audio())).toBe(0);
  });

  it("computes the tag length from the syncsafe size field", () => {
    const tag = buildId3v2Tag({ bodyBytes: 1024 });

    expect(tag.length).toBe(10 + 1024);
    expect(readId3v2TagLength(tag)).toBe(10 + 1024);
  });

  it("accounts for the optional ID3v2.4 footer", () => {
    const tag = buildId3v2Tag({ bodyBytes: 256, withFooter: true });

    expect(tag.length).toBe(10 + 256 + 10);
    expect(readId3v2TagLength(tag)).toBe(10 + 256 + 10);
  });

  it("skips an ID3v2 tag before the audio and does not count it as frames", () => {
    const tag = buildId3v2Tag({ bodyBytes: 2048 });
    const result = countMpeg1Layer3Frames(Buffer.concat([tag, audio()]));

    expect(result.frameCount).toBe(FRAMES);
    expect(result.audioStartOffset).toBe(tag.length);
  });

  it("does not count metadata bytes that look like frame sync words", () => {
    // A tag body full of 0xFF bytes would fool a sync-scanning counter.
    const tag = buildId3v2Tag({ bodyBytes: 4096, fillByte: 0xff });

    expect(
      countMpeg1Layer3Frames(Buffer.concat([tag, audio()])).frameCount,
    ).toBe(FRAMES);
  });

  it("yields the same count with and without leading metadata", () => {
    const withoutTag = countMpeg1Layer3Frames(audio()).frameCount;
    const withTag = countMpeg1Layer3Frames(
      Buffer.concat([buildId3v2Tag({ bodyBytes: 900 }), audio()]),
    ).frameCount;

    expect(withTag).toBe(withoutTag);
  });
});

describe("ID3v1 and other trailing metadata", () => {
  it("ignores a trailing ID3v1 tag", () => {
    const data = Buffer.concat([audio(), buildId3v1Tag()]);
    const result = countMpeg1Layer3Frames(data);

    expect(result.frameCount).toBe(FRAMES);
    expect(result.audioEndOffset).toBe(data.length - 128);
  });

  it("ignores a trailing ID3v1 extended tag followed by an ID3v1 tag", () => {
    const data = Buffer.concat([
      audio(),
      buildId3v1ExtendedTag(),
      buildId3v1Tag(),
    ]);
    const result = countMpeg1Layer3Frames(data);

    expect(result.frameCount).toBe(FRAMES);
    expect(result.audioEndOffset).toBe(data.length - 227 - 128);
  });

  it("ignores a trailing APEv2 tag", () => {
    const ape = buildApev2Tag(64);
    const data = Buffer.concat([audio(), ape]);
    const result = countMpeg1Layer3Frames(data);

    expect(result.frameCount).toBe(FRAMES);
    expect(result.audioEndOffset).toBe(data.length - ape.length);
  });

  it("ignores an APEv2 tag followed by an ID3v1 tag", () => {
    const ape = buildApev2Tag(64);
    const data = Buffer.concat([audio(), ape, buildId3v1Tag()]);

    expect(countMpeg1Layer3Frames(data).frameCount).toBe(FRAMES);
  });
});

describe("metadata at both ends", () => {
  it("counts only audio frames when the file is wrapped in ID3v2 and ID3v1", () => {
    const data = Buffer.concat([
      buildId3v2Tag({ bodyBytes: 3000, fillByte: 0xff }),
      audio(),
      buildId3v1Tag("wrapped"),
    ]);
    const result = countMpeg1Layer3Frames(data);

    expect(result.frameCount).toBe(FRAMES);
    expect(result.audioEndOffset - result.audioStartOffset).toBe(FRAMES * 417);
  });

  it("counts a Xing/Info header frame, which is itself a valid MPEG frame", () => {
    // Encoders put VBR metadata in the payload of the first frame. That frame
    // has a normal, valid header, so it is counted like any other frame.
    const xingFrame = buildFrame();
    xingFrame.write("Xing", 36, "latin1");
    const data = Buffer.concat([xingFrame, buildFrames(FRAMES)]);

    expect(countMpeg1Layer3Frames(data).frameCount).toBe(FRAMES + 1);
  });

  it("metadata never increases the frame count", () => {
    const bare = countMpeg1Layer3Frames(audio()).frameCount;
    const wrapped = countMpeg1Layer3Frames(
      Buffer.concat([
        buildId3v2Tag({ bodyBytes: 512 }),
        audio(),
        buildApev2Tag(),
        buildId3v1ExtendedTag(),
        buildId3v1Tag(),
      ]),
    ).frameCount;

    expect(wrapped).toBe(bare);
    expect(wrapped).toBe(FRAMES);
  });
});

describe("real encoder output (samples/sample.mp3)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sample = readFileSync(join(here, "..", "samples", "sample.mp3"));

  it("is a real file with ID3v2 at the head and ID3v1 at the tail", () => {
    expect(sample.toString("latin1", 0, 3)).toBe("ID3");
    expect(
      sample.toString("latin1", sample.length - 128, sample.length - 125),
    ).toBe("TAG");
  });

  it("locates the audio region between the two tags", () => {
    const result = countMpeg1Layer3Frames(sample);

    expect(result.audioStartOffset).toBe(readId3v2TagLength(sample));
    expect(result.audioStartOffset).toBeGreaterThan(0);
    expect(result.audioEndOffset).toBe(sample.length - 128);
  });

  it("counts every frame and consumes the audio region exactly", () => {
    const result = countMpeg1Layer3Frames(sample);

    // 5 s of 44.1 kHz audio at 1152 samples per frame is ~193 frames, plus the
    // LAME Xing header frame.
    expect(result.frameCount).toBe(194);
    expect(result.firstFrame.sampleRateHz).toBe(44_100);
    expect(result.firstFrame.bitrateKbps).toBe(128);
  });
});
