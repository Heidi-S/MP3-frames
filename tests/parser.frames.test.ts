import { describe, expect, it } from "vitest";

import {
  calculateFrameLengthBytes,
  countMpeg1Layer3Frames,
  readFrameHeader,
  ChannelMode,
} from "../src/parser/index.js";
import {
  BITRATE_INDEX_BY_KBPS,
  SAMPLE_RATE_INDEX_BY_HZ,
  buildFrame,
  buildFrameHeaderBytes,
  buildFrames,
  buildStream,
  expectedFrameLength,
} from "./helpers/mp3Builder.js";

const ALL_BITRATES = [...BITRATE_INDEX_BY_KBPS.keys()];
const ALL_SAMPLE_RATES = [...SAMPLE_RATE_INDEX_BY_HZ.keys()];

describe("frame length calculation", () => {
  // Reference values computed by hand from floor(144 * bitrate / sampleRate) + padding.
  const cases: ReadonlyArray<[number, number, boolean, number]> = [
    [128, 44_100, false, 417],
    [128, 44_100, true, 418],
    [128, 48_000, false, 384],
    [128, 48_000, true, 385],
    [128, 32_000, false, 576],
    [320, 44_100, false, 1044],
    [320, 48_000, false, 960],
    [32, 44_100, false, 104],
    [32, 48_000, false, 96],
    [32, 32_000, false, 144],
    [192, 44_100, false, 626],
    [192, 44_100, true, 627],
  ];

  it.each(cases)(
    "%i kbit/s at %i Hz (padding=%s) is %i bytes",
    (bitrate, sampleRate, padding, expected) => {
      expect(calculateFrameLengthBytes(bitrate, sampleRate, padding)).toBe(
        expected,
      );
    },
  );

  it("adds exactly one byte for the padding slot", () => {
    for (const bitrate of ALL_BITRATES) {
      for (const sampleRate of ALL_SAMPLE_RATES) {
        const unpadded = calculateFrameLengthBytes(bitrate, sampleRate, false);
        const padded = calculateFrameLengthBytes(bitrate, sampleRate, true);
        expect(padded - unpadded).toBe(1);
      }
    }
  });
});

describe("readFrameHeader", () => {
  it("decodes every field of a valid MPEG-1 Layer III header", () => {
    const frame = buildFrame({
      bitrateKbps: 192,
      sampleRateHz: 48_000,
      padding: true,
      crc: true,
      channelMode: ChannelMode.Mono,
    });

    const header = readFrameHeader(frame, 0);

    expect(header).toEqual({
      offset: 0,
      bitrateKbps: 192,
      sampleRateHz: 48_000,
      hasPadding: true,
      hasCrc: true,
      channelMode: ChannelMode.Mono,
      frameLengthBytes: 576 + 1,
    });
  });

  it("reads a header at a non-zero offset", () => {
    const prefix = Buffer.alloc(7, 0x00);
    const data = Buffer.concat([
      prefix,
      buildFrameHeaderBytes({ bitrateKbps: 64 }),
    ]);

    const header = readFrameHeader(data, prefix.length);

    expect(header.offset).toBe(prefix.length);
    expect(header.bitrateKbps).toBe(64);
  });

  it.each([
    [ChannelMode.Stereo],
    [ChannelMode.JointStereo],
    [ChannelMode.DualChannel],
    [ChannelMode.Mono],
  ])("accepts channel mode %i", (channelMode) => {
    const frame = buildFrame({ channelMode });
    expect(readFrameHeader(frame, 0).channelMode).toBe(channelMode);
  });

  it("reports the protection bit as CRC presence without changing frame length", () => {
    const withoutCrc = readFrameHeader(buildFrame({ crc: false }), 0);
    const withCrc = readFrameHeader(buildFrame({ crc: true }), 0);

    expect(withoutCrc.hasCrc).toBe(false);
    expect(withCrc.hasCrc).toBe(true);
    expect(withCrc.frameLengthBytes).toBe(withoutCrc.frameLengthBytes);
  });
});

describe("counting frames", () => {
  it("counts a single valid frame", () => {
    const result = countMpeg1Layer3Frames(buildFrame());

    expect(result.frameCount).toBe(1);
    expect(result.audioStartOffset).toBe(0);
    expect(result.firstFrame.frameLengthBytes).toBe(417);
  });

  it("counts multiple consecutive identical frames", () => {
    for (const count of [2, 3, 10, 250]) {
      expect(countMpeg1Layer3Frames(buildFrames(count)).frameCount).toBe(count);
    }
  });

  it.each(ALL_BITRATES)("counts frames at %i kbit/s", (bitrateKbps) => {
    const frames = 7;
    const data = buildFrames(frames, { bitrateKbps });

    expect(data.length).toBe(
      frames * expectedFrameLength(bitrateKbps, 44_100, false),
    );
    expect(countMpeg1Layer3Frames(data).frameCount).toBe(frames);
  });

  it.each(ALL_SAMPLE_RATES)("counts frames at %i Hz", (sampleRateHz) => {
    const frames = 5;
    const data = buildFrames(frames, { sampleRateHz });

    expect(data.length).toBe(
      frames * expectedFrameLength(128, sampleRateHz, false),
    );
    expect(countMpeg1Layer3Frames(data).frameCount).toBe(frames);
  });

  it("counts padded frames and advances by the padded length", () => {
    const data = buildFrames(4, { padding: true });

    expect(data.length).toBe(4 * 418);
    expect(countMpeg1Layer3Frames(data).frameCount).toBe(4);
  });

  it("handles a mix of padded and unpadded frames", () => {
    const data = buildStream([
      { padding: true },
      { padding: false },
      { padding: true },
      { padding: true },
      { padding: false },
    ]);

    expect(data.length).toBe(418 + 417 + 418 + 418 + 417);
    expect(countMpeg1Layer3Frames(data).frameCount).toBe(5);
  });

  it("handles variable bitrate streams (bitrate may change between frames)", () => {
    const specs = [
      { bitrateKbps: 128 },
      { bitrateKbps: 192 },
      { bitrateKbps: 320 },
      { bitrateKbps: 32 },
      { bitrateKbps: 128, padding: true },
    ];
    const data = buildStream(specs);

    expect(countMpeg1Layer3Frames(data).frameCount).toBe(specs.length);
  });

  it("covers combinations of valid header fields", () => {
    const specs = [];
    for (const bitrateKbps of ALL_BITRATES) {
      for (const padding of [false, true]) {
        for (const crc of [false, true]) {
          specs.push({ bitrateKbps, padding, crc, sampleRateHz: 48_000 });
        }
      }
    }
    const data = buildStream(specs);

    expect(countMpeg1Layer3Frames(data).frameCount).toBe(specs.length);
  });

  it("advances exactly one frame length, so payload bytes are never re-parsed", () => {
    // Plant a perfectly valid frame header *inside* the payload of frame 1.
    // A naive "scan for sync and increment" implementation would report 3.
    const frame = buildFrame();
    const decoy = buildFrameHeaderBytes({ bitrateKbps: 64 });
    decoy.copy(frame, 100);
    const data = Buffer.concat([frame, buildFrame()]);

    expect(countMpeg1Layer3Frames(data).frameCount).toBe(2);
  });

  it("does not count 0xFF-filled payload bytes as frames", () => {
    const data = buildFrames(3, { fillByte: 0xff });

    expect(countMpeg1Layer3Frames(data).frameCount).toBe(3);
  });

  it("reports the audio region boundaries it used", () => {
    const data = buildFrames(6);
    const result = countMpeg1Layer3Frames(data);

    expect(result.audioStartOffset).toBe(0);
    expect(result.audioEndOffset).toBe(data.length);
    expect(result.audioEndOffset - result.audioStartOffset).toBe(6 * 417);
  });
});
