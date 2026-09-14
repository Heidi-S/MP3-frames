/**
 * Metadata region detection.
 *
 * MP3 files are containers in practice: tagging software prepends and appends
 * blocks that are not MPEG audio. This module answers exactly one question —
 * "which byte range of the file is the audio stream?" — by recognising the
 * well-defined metadata containers at the head and tail of the file.
 *
 * Only *structurally described* regions are skipped. The parser never skips
 * arbitrary unknown bytes; anything it cannot account for is an error.
 *
 * Supported regions:
 *   head: ID3v2 (any minor version), including the optional ID3v2.4 footer
 *   tail: ID3v1 (128 B), ID3v1 extended "TAG+" (227 B), APEv2 (footer-described)
 */

import { Mp3ParseError } from './errors.js';

/* --- ID3v2 (leading) ------------------------------------------------------ */

const ID3V2_IDENTIFIER = 'ID3';
const ID3V2_HEADER_BYTES = 10;
const ID3V2_FOOTER_BYTES = 10;
const ID3V2_FLAG_FOOTER_PRESENT = 0b0001_0000;
const ID3V2_SIZE_OFFSET = 6;
const ID3V2_SIZE_BYTES = 4;
/** Syncsafe integers use only the low 7 bits of each byte. */
const SYNCSAFE_BITS_PER_BYTE = 7;
const SYNCSAFE_BYTE_MASK = 0b0111_1111;

/* --- ID3v1 / ID3v1 extended (trailing) ------------------------------------ */

const ID3V1_IDENTIFIER = 'TAG';
const ID3V1_BYTES = 128;
const ID3V1_EXTENDED_IDENTIFIER = 'TAG+';
const ID3V1_EXTENDED_BYTES = 227;

/* --- APEv2 (trailing) ----------------------------------------------------- */

const APE_FOOTER_IDENTIFIER = 'APETAGEX';
const APE_FOOTER_BYTES = 32;
const APE_TAG_SIZE_OFFSET = 12; // uint32 LE: tag size excluding the header
const APE_FLAGS_OFFSET = 20;
const APE_FLAG_HAS_HEADER = 0x8000_0000;
const APE_HEADER_BYTES = 32;

/**
 * Length in bytes of the ID3v2 tag at the start of `data`, or 0 if absent.
 *
 * Layout: "ID3" | version (2) | flags (1) | size (4, syncsafe) | body | footer?
 * The 4 size bytes are syncsafe (7 significant bits each) and exclude both the
 * 10-byte header and the optional 10-byte footer.
 */
export function readId3v2TagLength(data: Buffer): number {
  if (data.length < ID3V2_HEADER_BYTES) {
    return 0;
  }
  if (data.toString('latin1', 0, ID3V2_IDENTIFIER.length) !== ID3V2_IDENTIFIER) {
    return 0;
  }

  const flags = data.readUInt8(5);
  let size = 0;
  for (let i = 0; i < ID3V2_SIZE_BYTES; i += 1) {
    const byte = data.readUInt8(ID3V2_SIZE_OFFSET + i);
    if ((byte & ~SYNCSAFE_BYTE_MASK) !== 0) {
      throw new Mp3ParseError(
        'MALFORMED_ID3V2',
        'ID3v2 tag declares a malformed (non-syncsafe) size.',
        { offset: ID3V2_SIZE_OFFSET + i },
      );
    }
    size = (size << SYNCSAFE_BITS_PER_BYTE) | (byte & SYNCSAFE_BYTE_MASK);
  }

  const hasFooter = (flags & ID3V2_FLAG_FOOTER_PRESENT) !== 0;
  const total = ID3V2_HEADER_BYTES + size + (hasFooter ? ID3V2_FOOTER_BYTES : 0);

  if (total > data.length) {
    throw new Mp3ParseError(
      'MALFORMED_ID3V2',
      'ID3v2 tag declares a size larger than the file itself.',
      { offset: 0 },
    );
  }
  return total;
}

/**
 * Exclusive end offset of the audio stream: the file length minus every
 * recognised trailing metadata block. Blocks are stripped repeatedly because
 * taggers legitimately stack them (e.g. APEv2 followed by ID3v1).
 */
export function findAudioEndOffset(data: Buffer, audioStart: number): number {
  let end = data.length;
  let stripping = true;

  while (stripping && end > audioStart) {
    stripping = false;

    // ID3v1: exactly 128 bytes, beginning with "TAG" (but not "TAG+").
    if (end - audioStart >= ID3V1_BYTES) {
      const start = end - ID3V1_BYTES;
      if (
        data.toString('latin1', start, start + ID3V1_IDENTIFIER.length) === ID3V1_IDENTIFIER &&
        data.toString('latin1', start, start + ID3V1_EXTENDED_IDENTIFIER.length) !==
          ID3V1_EXTENDED_IDENTIFIER
      ) {
        end = start;
        stripping = true;
        continue;
      }
    }

    // ID3v1 extended: 227 bytes beginning with "TAG+", placed before ID3v1.
    if (end - audioStart >= ID3V1_EXTENDED_BYTES) {
      const start = end - ID3V1_EXTENDED_BYTES;
      if (
        data.toString('latin1', start, start + ID3V1_EXTENDED_IDENTIFIER.length) ===
        ID3V1_EXTENDED_IDENTIFIER
      ) {
        end = start;
        stripping = true;
        continue;
      }
    }

    // APEv2: a 32-byte footer that declares the size of the rest of the tag.
    if (end - audioStart >= APE_FOOTER_BYTES) {
      const footerStart = end - APE_FOOTER_BYTES;
      if (
        data.toString('latin1', footerStart, footerStart + APE_FOOTER_IDENTIFIER.length) ===
        APE_FOOTER_IDENTIFIER
      ) {
        const tagSize = data.readUInt32LE(footerStart + APE_TAG_SIZE_OFFSET);
        const flags = data.readUInt32LE(footerStart + APE_FLAGS_OFFSET);
        const headerBytes = (flags & APE_FLAG_HAS_HEADER) !== 0 ? APE_HEADER_BYTES : 0;
        const total = tagSize + headerBytes;
        if (total > 0 && end - total >= audioStart) {
          end -= total;
          stripping = true;
          continue;
        }
      }
    }
  }

  return end;
}
