/**
 * Generates `samples/generated-sample.mp3`: a structurally valid MPEG-1 Layer
 * III file with a frame count that is known by construction, used by the
 * end-to-end test alongside the real encoder output in `samples/sample.mp3`.
 *
 * The payload is filler rather than encoded audio — the point of this fixture
 * is the frame *structure* (headers, lengths, padding accumulation, ID3 tags),
 * which is exactly what the parser inspects. Because it is generated rather
 * than downloaded, the repository needs no binary provenance and the expected
 * frame count cannot drift.
 *
 * Run with: npm run generate:sample
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRAME_COUNT = 500;
const BITRATE_KBPS = 128;
const BITRATE_INDEX = 9; // 128 kbit/s
const SAMPLE_RATE_HZ = 44_100;
const SAMPLE_RATE_INDEX = 0; // 44100 Hz
const CHANNEL_MODE_JOINT_STEREO = 0b01;

function buildFrame(padding: boolean): Buffer {
  const length =
    Math.floor((144 * BITRATE_KBPS * 1000) / SAMPLE_RATE_HZ) +
    (padding ? 1 : 0);
  const frame = Buffer.alloc(length, 0x00);
  frame[0] = 0xff;
  // MPEG-1 (0b11), Layer III (0b01), protection bit set => no CRC
  frame[1] = 0b1111_1011;
  frame[2] =
    (BITRATE_INDEX << 4) | (SAMPLE_RATE_INDEX << 2) | ((padding ? 1 : 0) << 1);
  frame[3] = CHANNEL_MODE_JOINT_STEREO << 6;
  return frame;
}

/**
 * Reproduce a real encoder's padding behaviour: 1152 samples at 128 kbit/s and
 * 44.1 kHz is 417.96 bytes, so padding is applied whenever the accumulated
 * fractional remainder reaches one whole byte.
 */
function buildAudioStream(): Buffer {
  const exact = (144 * BITRATE_KBPS * 1000) / SAMPLE_RATE_HZ;
  const whole = Math.floor(exact);
  const frames: Buffer[] = [];
  let remainder = 0;

  for (let i = 0; i < FRAME_COUNT; i += 1) {
    remainder += exact - whole;
    const padding = remainder >= 1;
    if (padding) {
      remainder -= 1;
    }
    frames.push(buildFrame(padding));
  }
  return Buffer.concat(frames);
}

function buildId3v2Tag(): Buffer {
  // A single TIT2 (title) frame inside an ID3v2.3 tag.
  const text = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from("MP3 Frame Analysis Sample", "latin1"),
  ]);
  const frameHeader = Buffer.alloc(10);
  frameHeader.write("TIT2", 0, "latin1");
  frameHeader.writeUInt32BE(text.length, 4);
  const body = Buffer.concat([frameHeader, text, Buffer.alloc(64, 0x00)]);

  const header = Buffer.alloc(10);
  header.write("ID3", 0, "latin1");
  header[3] = 3; // v2.3
  header[4] = 0;
  header[5] = 0;
  const size = body.length;
  header[6] = (size >> 21) & 0x7f;
  header[7] = (size >> 14) & 0x7f;
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;

  return Buffer.concat([header, body]);
}

function buildId3v1Tag(): Buffer {
  const tag = Buffer.alloc(128, 0x00);
  tag.write("TAG", 0, "latin1");
  tag.write("MP3 Frame Analysis Sample", 3, "latin1");
  tag.write("Generated", 33, "latin1");
  return tag;
}

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = join(here, "..", "samples", "generated-sample.mp3");

const file = Buffer.concat([
  buildId3v2Tag(),
  buildAudioStream(),
  buildId3v1Tag(),
]);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, file);

console.log(`Wrote ${outputPath}`);
console.log(`  bytes:  ${file.length}`);
console.log(`  frames: ${FRAME_COUNT}`);
