/**
 * A minimal zip reader, the counterpart of the writer beside it.
 *
 * Reads the central directory rather than scanning for local headers. The
 * directory is the authoritative list — a local header may declare its sizes in
 * a trailing descriptor instead of up front, which cannot be read forwards —
 * and it is where a well-formed archive says what it contains.
 *
 * Stored entries are taken as they are. Deflated ones go through
 * `DecompressionStream`, which is why reading is asynchronous where writing is
 * not: implementing inflate by hand to keep it synchronous would be a lot of
 * subtle code to avoid one `await`. Our own exports are stored; a UFO zipped by
 * anything else is usually deflated.
 */

const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const STORED = 0;
const DEFLATED = 8;

export type ZipFile = {
  /** Path inside the archive, with forward slashes. */
  readonly path: string;
  readonly bytes: Uint8Array;
};

export type ZipReadError = { readonly reason: string };

/**
 * Read every file in an archive.
 *
 * Directory entries — those whose name ends in a slash — are skipped: they carry
 * no content, and a caller looking things up by path has no use for them.
 */
export async function unzip(source: ArrayBuffer): Promise<ZipFile[] | ZipReadError> {
  const bytes = new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const end = findEndOfDirectory(view, bytes.length);
  if (end < 0) return { reason: "not a zip archive: no end-of-directory record" };

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);

  const files: ZipFile[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length) return { reason: "the central directory runs past the end" };
    if (view.getUint32(at, true) !== CENTRAL_HEADER) {
      return { reason: "the central directory is malformed" };
    }

    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const path = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));

    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith("/")) continue;

    // The local header's own name and extra lengths, not the directory's: the
    // two are permitted to differ, and the data starts after the local one.
    if (localAt + 30 > bytes.length) return { reason: `${path} points outside the archive` };
    const localNameLength = view.getUint16(localAt + 26, true);
    const localExtraLength = view.getUint16(localAt + 28, true);
    const from = localAt + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(from, from + compressed);

    if (method === STORED) {
      files.push({ path, bytes: raw });
    } else if (method === DEFLATED) {
      const inflated = await inflate(raw);
      if (inflated === null) return { reason: `${path} could not be decompressed` };
      files.push({ path, bytes: inflated });
    } else {
      return { reason: `${path} uses an unsupported compression method` };
    }
  }

  return files;
}

/** Look up one file's text, or `null`. */
export function fileText(files: readonly ZipFile[], path: string): string | null {
  const found = files.find((f) => f.path === path);
  return found === undefined ? null : new TextDecoder().decode(found.bytes);
}

async function inflate(raw: Uint8Array): Promise<Uint8Array | null> {
  const Stream = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (Stream === undefined) return null;

  try {
    const stream = new Stream("deflate-raw");
    const writer = stream.writable.getWriter();
    // A fresh copy: a subarray shares its buffer with the whole archive, and the
    // stream is entitled to detach whatever it is handed.
    void writer.write(new Uint8Array(raw));
    void writer.close();

    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) chunks.push(value as Uint8Array);
    }

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Find the end-of-directory record, scanning back from the end.
 *
 * It is the last thing in the file unless there is an archive comment, which may
 * be up to 64k. Scanning back over that range is what every zip reader does, for
 * want of anywhere the record's position is written down.
 */
function findEndOfDirectory(view: DataView, length: number): number {
  const earliest = Math.max(0, length - 0xffff - 22);
  for (let at = length - 22; at >= earliest; at--) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) return at;
  }
  return -1;
}
