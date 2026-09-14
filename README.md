# MP3 File Analysis App

A small Express API that accepts an MP3 upload and returns the number of MPEG audio frames it
contains.

**The MPEG frame parser is implemented directly in TypeScript, from the MPEG-1 specification.**
**No NPM package, media library, command-line tool, or external service is used to parse MP3 frame
data or to count frames.** The only runtime dependencies are Express (HTTP) and multer
(`multipart/form-data` parsing); neither one looks at the audio bytes.

---

## Contents

- [Purpose](#purpose)
- [Technology choices](#technology-choices)
- [Project structure](#project-structure)
- [Installation](#installation)
- [Commands](#commands)
- [API](#api)
- [Supported and unsupported formats](#supported-and-unsupported-formats)
- [Error behaviour](#error-behaviour)
- [Metadata handling](#metadata-handling)
- [How frame counting works](#how-frame-counting-works)
- [Frame-length calculation](#frame-length-calculation)
- [Sample files](#sample-files)
- [Testing](#testing)
- [Security and resource limits](#security-and-resource-limits)
- [Assumptions](#assumptions)

---

## Purpose

Demonstrate that MPEG-1 Layer III frame data can be parsed and counted from raw binary input
without delegating to an existing decoder. The API is deliberately one endpoint wide: upload a
file, get back the frame count, or get back a precise reason why the file could not be counted.

The design priority throughout is **correctness over recovery**. A file that cannot be fully
accounted for produces an error, never a plausible-looking number.

## Technology choices

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript 5 (strict) | Binary parsing benefits from exhaustive types and no implicit `any` |
| Runtime | Node.js ≥ 20 | `Buffer` gives direct, bounds-checked byte access |
| HTTP framework | Express 5 | Required by the brief; minimal surface for a single endpoint |
| Multipart parsing | multer 2 (memory storage) | Infrastructure only — it never inspects MP3 bytes |
| Tests | Vitest 4 + supertest | Fast TypeScript-native runner; supertest drives the app in-process |
| Dev tooling | tsx, tsc | `tsx` for watch mode, `tsc` for the production build |

`npm audit` reports **0 vulnerabilities**. There are exactly two runtime dependencies, and neither
one sees the audio bytes: Express hands off the request, multer turns `multipart/form-data` into a
`Buffer`, and everything after that is code in `src/parser/`.

Strict compiler settings are on, including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
and `verbatimModuleSyntax`. See [`tsconfig.json`](./tsconfig.json).

## Project structure

```
.
├── src/
│   ├── parser/                  # Pure MP3 parsing — no Express, no I/O
│   │   ├── constants.ts         # Header bit layout, bitrate/sample-rate tables
│   │   ├── errors.ts            # Mp3ParseError + the error-code union
│   │   ├── frameHeader.ts       # Header decoding + frame-length calculation
│   │   ├── id3.ts               # ID3v2 / ID3v1 / ID3v1-ext / APEv2 region detection
│   │   ├── mp3Parser.ts         # Frame traversal and counting
│   │   └── index.ts             # Public surface of the parser
│   ├── http/
│   │   ├── config.ts            # Upload limit, field name, port
│   │   ├── errors.ts            # HttpError + parser-code → status mapping
│   │   ├── middleware.ts        # 404 handler + central error handler
│   │   ├── upload.ts            # multer configuration and normalisation
│   │   └── routes/fileUpload.ts # POST /file-upload
│   ├── app.ts                   # createApp() — no listen(), so tests can reuse it
│   └── index.ts                 # Server bootstrap
├── tests/
│   ├── helpers/mp3Builder.ts    # Test-only byte builders (valid and invalid)
│   ├── parser.frames.test.ts
│   ├── parser.metadata.test.ts
│   ├── parser.invalid.test.ts
│   └── http.fileUpload.test.ts
├── scripts/
│   ├── check-node.cjs           # Node version guard (ES5, so it runs anywhere)
│   └── generate-sample.ts       # Regenerates samples/generated-sample.mp3
└── samples/
    ├── sample.mp3               # Real encoder output — 194 frames
    └── generated-sample.mp3     # Synthetic fixture — 500 frames
```

The parser directory imports nothing from `http/` and knows nothing about Express, requests, or
files on disk. Its entire contract is `Buffer → number` (or a thrown `Mp3ParseError`), which is why
it can be unit-tested exhaustively without an HTTP server.

## Installation

**Node.js 20 or newer is required.** Check first:

```bash
node -v
```

If that prints anything below `v20`, install a current Node before going further — the dev and test
tooling (`tsx`, `vitest`) requires Node 18+, and the source uses modern JavaScript that older
versions cannot parse. With [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 20 && nvm use 20     # an .nvmrc is included, so `nvm use` alone works too
```

On macOS, `brew install node` or the installer from [nodejs.org](https://nodejs.org) work equally
well. Note that a system Node at `/usr/local/bin/node` can shadow an nvm-managed one — if `node -v`
still reports the old version in a new shell, check `which node`.

Then:

```bash
npm install
```

The project guards against this: `.npmrc` sets `engine-strict=true`, and `npm run dev|build|test|start`
each run `scripts/check-node.cjs` first, which prints a clear message and exits rather than letting
the tooling fail with a confusing syntax error.

A `package-lock.json` is committed. If `npm install` ever fails to resolve the tree, use
`npm ci`, which installs the locked versions exactly.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the server in watch mode (`tsx watch`) on port 3000 |
| `npm run build` | Type-check and compile to `dist/` |
| `npm start` | Run the compiled server (`node dist/index.js`) — run `npm run build` first |
| `npm test` | Run the full test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check `src`, `tests` and `scripts` without emitting |
| `npm run generate:sample` | Regenerate `samples/generated-sample.mp3` |
| `npm run check-node` | Verify the Node version (runs automatically before the scripts above) |

The listening port can be overridden with the `PORT` environment variable.

### Troubleshooting

**`npm run dev` exits with `ELIFECYCLE` / `Exit status 1` and little else.** Almost always an
outdated Node. `npm run dev` now checks for this and says so explicitly; if you are on a Node old
enough that even `npm` differs (npm 6 ships with Node 12), upgrade Node as described under
[Installation](#installation), then `rm -rf node_modules package-lock.json && npm install`.

**`npm install` fails with `Cannot read properties of null (reading 'edgesOut')`.** An npm
resolver bug, not a real dependency conflict. Run `npm ci` instead, or upgrade npm with
`npm install -g npm@latest`.

## API

### `POST /file-upload`

Accepts one MP3 file as `multipart/form-data`.

| | |
| --- | --- |
| Multipart field name | **`file`** |
| Maximum upload size | 20 MB |
| Success status | `200` |
| Success content type | `application/json` |

**Success response** — exactly one property:

```json
{
  "frameCount": 12345
}
```

`frameCount` is the number of complete MPEG-1 Layer III frames that were successfully parsed and
validated.

**Example request**

```bash
curl -X POST -F "file=@samples/sample.mp3" http://localhost:3000/file-upload
```

```json
{"frameCount":194}
```

Neither the filename nor the client's `Content-Type` is consulted. A file called `notes.txt` sent
as `text/plain` is accepted if its bytes are a valid MPEG-1 Layer III stream, and a file called
`song.mp3` sent as `audio/mpeg` is rejected if they are not.

## Supported and unsupported formats

**Supported: MPEG Version 1, Audio Layer III — and nothing else.**

Explicitly rejected:

- MPEG Version 2 (version id `0b10`)
- MPEG Version 2.5 (version id `0b00`)
- Reserved MPEG version id (`0b01`)
- Layer I (`0b11`) and Layer II (`0b10`)
- Reserved layer value (`0b00`)
- Free-format bitrate (bitrate index `0`) — the frame length is not derivable from the header alone
- Reserved bitrate index (`15`)
- Reserved sampling-rate index (`3`)
- Reserved emphasis value (`0b10`)
- Truncated frames, misaligned frames, and streams whose sampling rate changes mid-file

Valid MPEG-1 Layer III bitrates (kbit/s): 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256,
320. Valid sampling rates (Hz): 44 100, 48 000, 32 000. Both live in `readonly` lookup tables in
[`src/parser/constants.ts`](./src/parser/constants.ts) rather than as inline literals.

## Error behaviour

All errors are JSON. The shape is:

```json
{
  "error": {
    "code": "UNSUPPORTED_MPEG_VERSION",
    "message": "MPEG Version 2 frame at byte offset 45: only MPEG Version 1 is supported."
  }
}
```

`code` is stable and machine-readable; `message` is a short human-readable explanation. Stack
traces and internal details are never serialised — unexpected failures are logged server-side and
returned as a generic `500 INTERNAL_ERROR`.

### Status codes

| Status | When | Codes |
| --- | --- | --- |
| `400 Bad Request` | The request itself is wrong | `MISSING_FILE`, `EMPTY_FILE`, `UNEXPECTED_FIELD`, `TOO_MANY_FILES`, `INVALID_MULTIPART_REQUEST` |
| `413 Payload Too Large` | Upload exceeds 20 MB | `FILE_TOO_LARGE` |
| `422 Unprocessable Content` | The request is well-formed but the bytes are not countable MPEG-1 Layer III audio | `FILE_TOO_SMALL`, `MALFORMED_ID3V2`, `NO_AUDIO_DATA`, `NO_AUDIO_FRAMES`, `INVALID_SYNC`, `RESERVED_MPEG_VERSION`, `UNSUPPORTED_MPEG_VERSION`, `RESERVED_LAYER`, `UNSUPPORTED_LAYER`, `FREE_FORMAT_BITRATE`, `RESERVED_BITRATE`, `RESERVED_SAMPLE_RATE`, `RESERVED_EMPHASIS`, `TRUNCATED_FRAME`, `INCONSISTENT_STREAM` |
| `404 Not Found` | Unknown route | `NOT_FOUND` |
| `500 Internal Server Error` | Unexpected failure | `INTERNAL_ERROR` |

The split between 400 and 422 is the chosen convention: 400 means "fix your request", 422 means
"your request was fine, but we cannot interpret this payload". Both are 4xx, as required.

Every parser rejection carries a distinct code, so the HTTP layer maps codes to statuses in a single
`switch` ([`src/http/errors.ts`](./src/http/errors.ts)) and never inspects error strings.

## Metadata handling

An `.mp3` file is a container in practice, and not every byte in it belongs to an MPEG frame. Before
counting anything, the parser establishes the byte range that actually holds audio:

**Leading — ID3v2** (`src/parser/id3.ts`). If the file begins with `"ID3"`, the 10-byte header is
read: 3 identifier bytes, 2 version bytes, 1 flags byte, then a 4-byte *syncsafe* size (7
significant bits per byte) that excludes the header itself. The audio therefore starts at
`10 + size`, plus another 10 bytes when the ID3v2.4 footer flag (`0x10`) is set. A size field that is
not syncsafe, or that exceeds the file length, is rejected as `MALFORMED_ID3V2`.

**Trailing** — recognised tail blocks are stripped repeatedly, because taggers legitimately stack
them:

- **ID3v1** — exactly 128 bytes beginning with `"TAG"`
- **ID3v1 extended** — 227 bytes beginning with `"TAG+"`, placed immediately before the ID3v1 tag
- **APEv2** — a 32-byte footer beginning with `"APETAGEX"` that declares the rest of the tag's size

Only these structurally described regions are skipped. The parser never skips arbitrary unknown
bytes: anything between the leading and trailing metadata must parse as complete frames, or the
request fails. Metadata bytes are never fed to the frame parser, so a tag padded with `0xFF` bytes —
which would fool a sync-scanning counter — cannot inflate the frame count. There are tests for
exactly that case.

## How frame counting works

The parser is deterministic and **never scans for the sync pattern**. It starts at a known offset
and walks the stream frame by frame:

1. Reject an empty file immediately.
2. Compute `audioStart` by skipping any ID3v2 tag, and `audioEnd` by stripping trailing tags.
3. At the current offset, read the 4-byte frame header (`src/parser/frameHeader.ts`):
   - verify the 11-bit frame sync (`0xFF` followed by three set bits)
   - confirm the MPEG version id is `0b11` (**MPEG Version 1**)
   - confirm the layer id is `0b01` (**Layer III**)
   - look up the 4-bit bitrate index in the MPEG-1 Layer III table, rejecting free (`0`) and
     reserved (`15`)
   - look up the 2-bit sampling-rate index, rejecting reserved (`3`)
   - read the padding bit, the protection bit (CRC presence) and the channel mode
   - reject the reserved emphasis value
4. Calculate the frame length from bitrate, sampling rate and padding (below).
5. Check cross-frame consistency: the sampling rate must not change mid-stream. Bitrate *may*
   change, because variable bitrate encoding is normal and legal.
6. Verify the whole calculated frame fits inside the remaining audio region; if not, the file is
   truncated and the request fails.
7. Advance by **exactly** the calculated frame length and repeat from step 3.
8. When the offset reaches `audioEnd`, return the count.

Two properties follow from step 7, and both are covered by tests:

- A `0xFF 0xFB` byte pair that happens to occur *inside* a frame's payload is never counted, because
  the parser never looks there. A test plants a perfectly valid header inside a payload and asserts
  the count is unchanged.
- If the data is corrupt or misaligned, the byte after a frame will not hold a valid header, and the
  parse fails loudly instead of resynchronising. A test inserts a single stray byte between two
  valid frames and asserts an error rather than a count of 2.

If the parser cannot account for every byte of the audio region, it throws. It never returns a
partial count.

## Frame-length calculation

An MPEG-1 Layer III frame always carries exactly **1152 samples per channel**. From that:

```
bytes per second   = bitrate_bits_per_second / 8
frame duration (s) = 1152 / sampleRate
frame length       = (1152 / 8) × bitrate_bps / sampleRate
                   = 144 × bitrate_kbps × 1000 / sampleRate
```

Because 1152 samples rarely divide into a whole number of bytes, the result is floored and the
encoder sets the **padding bit** on some frames to add one extra slot, keeping the average bitrate
exact. In Layer III a slot is one byte, so:

```
frameLength = floor(144 × bitrate_kbps × 1000 / sampleRate) + (padding ? 1 : 0)
```

Worked example — 128 kbit/s at 44 100 Hz:

```
144 × 128 000 / 44 100 = 417.959…  →  417 bytes, or 418 with the padding bit set
```

The optional 16-bit CRC (present when the protection bit is `0`) lives *inside* that length, so it
needs no adjustment. The constant `144` is the MPEG-1 Layer III value only; Layer I uses 12 and a
4-byte slot, and MPEG-2/2.5 Layer III use 72 — which is one more reason this parser is deliberately
version- and layer-specific rather than generic.

The implementation is [`calculateFrameLengthBytes`](./src/parser/frameHeader.ts), and the tests
assert it against independently hand-computed reference values.

## Sample files

`samples/sample.mp3` — **real encoder output**: a 5-second 128 kbit/s, 44.1 kHz joint-stereo file
produced by LAME, complete with an ID3v2 tag, an ID3v1 tag and a Xing/LAME header frame. The API
reports **194 frames** for it. As a cross-check, `ffprobe -count_packets` reports 193 audio packets
for the same file; the difference is the Xing/LAME header frame, which ffprobe consumes as stream
metadata while this parser counts it — see [Assumptions](#assumptions).

`samples/generated-sample.mp3` — a synthetic fixture of **500 frames** built by
`npm run generate:sample`, including realistic padding accumulation and both ID3 tags. Its frame
count is known by construction, so the end-to-end test cannot drift.

Both files are asserted in the end-to-end tests.

## Testing

```bash
npm test
```

108 tests across four suites:

**`parser.frames.test.ts`** — frame-length arithmetic against hand-computed reference values; the
padding slot is exactly one byte for every bitrate/sample-rate pair; full header field decoding;
one frame; many consecutive frames; every valid bitrate; every valid sampling rate; padded frames;
mixed padded/unpadded streams; variable bitrate; every combination of bitrate × padding × CRC;
correct advancement (a valid header planted inside a payload does not inflate the count); a
`0xFF`-filled payload does not inflate the count.

**`parser.metadata.test.ts`** — ID3v2 length from the syncsafe size field; the ID3v2.4 footer;
ID3v2 before audio; ID3v1 after audio; ID3v1 extended; APEv2; stacked tags; a tag body full of
`0xFF` bytes; metadata never increases the count; the Xing header frame; and the real
`samples/sample.mp3`, including the located audio-region boundaries.

**`parser.invalid.test.ts`** — empty file; a file with no MPEG audio; a file that is only metadata;
a file shorter than one header; malformed ID3v2 size; ID3v2 larger than the file; broken sync;
reserved version; MPEG-2; MPEG-2.5; reserved layer; Layer I; Layer II; free-format bitrate;
reserved bitrate; reserved sampling rate; reserved emphasis; a bad header after several good
frames; a truncated final frame; a trailing fragment; trailing junk; a misaligned stream; a
mid-stream sampling-rate change; and the guarantee that no partial count is ever returned.

**`http.fileUpload.test.ts`** — a valid upload returns `200`, `application/json`, and a body whose
key set is exactly `["frameCount"]` with the exact expected count; VBR uploads; tagged uploads;
ignoring the filename extension and client `Content-Type`; both sample files end-to-end; missing
`file` field; non-multipart body; wrong field name; empty upload; a non-MP3 file; MPEG-2; MPEG-2.5;
Layer II; reserved bitrate; reserved sampling rate; a truncated frame; an oversized upload; the
JSON 404; and the absence of `x-powered-by`.

## Security and resource limits

- **Upload size** is capped at 20 MB (`MAX_UPLOAD_BYTES` in `src/http/config.ts`). Exceeding it
  returns `413` and multer aborts the stream rather than buffering the rest.
- **In-memory buffering** is a deliberate, documented choice: the parser needs random access to the
  bytes and does one synchronous pass, so multer's memory storage is used and no temporary files are
  written. The worst case is one 20 MB buffer per in-flight request; raising the limit meaningfully
  would mean moving to disk-backed or streaming parsing.
- **Bounds safety**: every read is preceded by an explicit length check, and `Buffer.readUInt8`
  throws rather than reading out of range. The parser can never read past the end of the buffer, and
  the traversal offset is monotonically increasing by at least 96 bytes per iteration, so it always
  terminates.
- Exactly one file and a bounded number of non-file fields are accepted per request.
- No body parsers are registered, so nothing is buffered for routes that would never read it.
- `x-powered-by` is disabled, and error responses never contain stack traces.
- Dependencies are current and `npm audit` reports 0 vulnerabilities: Express 5 and multer 2
  (multer 1.x carries known advisories and is deliberately not used).

No database, cache, queue, authentication, container, or external service is involved. The whole
flow is: **client → Express → multer → custom MPEG-1 Layer III parser → frame count → JSON**.

## Assumptions

The brief left a few things open. The choices made here:

1. **Error body shape.** `{ "error": { "code", "message" } }`, with 400 for request problems, 422
   for unparseable payloads, 413 for oversized uploads. The success body remains exactly
   `{ "frameCount": n }`.
2. **The Xing/Info/LAME header frame is counted.** It is a structurally valid MPEG-1 Layer III
   frame that merely carries VBR metadata in its payload, and the endpoint's contract is "frames
   successfully parsed". Tools that report the *audio* frame count (such as `ffprobe`) exclude it,
   so expect a difference of exactly 1 against them for LAME-encoded files.
3. **Free-format bitrate (index 0) is rejected** rather than inferred. Its frame length is not
   described by the header, so counting it would require heuristics — precisely what the brief rules
   out.
4. **Reserved emphasis (`0b10`) is treated as a malformed header**, consistently with the other
   reserved fields.
5. **The sampling rate must be constant** across the stream; a change is treated as loss of frame
   alignment. Bitrate changes are allowed (VBR).
6. **No leading or trailing slack is tolerated.** Audio must begin immediately after the ID3v2 tag
   and end at the trailing metadata, with no arbitrary padding in between. This is stricter than
   some decoders, and follows the brief's instruction not to silently skip data outside a
   well-defined non-audio region.
7. **APEv2 and ID3v1-extended trailers are recognised** in addition to the required ID3v1/ID3v2
   handling, because they are well-defined and common; without this, ordinary tagged files would
   fail for no good reason.
8. **Only `POST /file-upload` exists.** No health check or metadata endpoint was specified, so none
   was added.
