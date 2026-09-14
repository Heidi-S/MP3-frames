/** HTTP-layer configuration. */

const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * Maximum accepted upload size.
 *
 * The uploaded file is buffered in memory (multer's memory storage) because the
 * parser needs random access to the bytes and the whole exercise is a single
 * synchronous pass. A hard limit keeps that bounded: at 20 MB the worst case is
 * one 20 MB buffer per in-flight request. Raising this limit meaningfully would
 * mean moving to disk-backed or streaming parsing.
 */
export const MAX_UPLOAD_BYTES = 20 * BYTES_PER_MEGABYTE;

/** The multipart field name the endpoint expects. Fixed by the API contract. */
export const UPLOAD_FIELD_NAME = 'file';

export const DEFAULT_PORT = 3000;
