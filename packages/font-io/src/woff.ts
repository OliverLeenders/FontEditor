import { Bytes } from "./bytes.js";
import { readTablesOf, sfntOf, tableChecksum } from "./sfnt.js";

/**
 * WOFF, which is a font wrapped for the web.
 *
 * Not another way of drawing a font: the same tables, in the same order, each
 * one deflated on its own, behind a header saying how big it was before. A
 * browser unwraps it back into exactly the OTF or TTF it was made from — so
 * everything hard about compiling a font has already happened by the time this
 * is called, and this file is only about the wrapping.
 *
 * Version 1, which is the one that needs no dependency: deflate is what a
 * browser already has. Version 2 is Brotli plus a transform that takes `glyf`
 * apart, and it is somebody else's compiled C++ — see `woff2.ts`.
 *
 * WOFF1 is still worth writing with WOFF2 beside it. It is the fallback every
 * `@font-face` stack lists second, it is what a tool older than 2015 will take,
 * and it costs a page of code.
 */

/** `wOFF`, the four bytes at the front of one. */
const SIGNATURE = 0x774f4646;

/** The fixed part of the file, before the table directory. */
const HEADER = 44;

/** One entry of that directory: tag, where, how big, how big it was, checksum. */
const RECORD = 20;

/**
 * Wrap a finished font as WOFF.
 *
 * Asynchronous because the compressor is: `CompressionStream` is the browser's
 * own deflate, which is the whole reason this needs nothing installed. It is a
 * stream rather than a function, so the answer arrives in pieces.
 */
export async function toWoff(sfnt: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const flavour = view.getUint32(0);
  const tables = readTablesOf(sfnt);

  // Compressed first, because where each table lands depends on how big the one
  // before it turned out to be.
  const packed = await Promise.all(tables.map(async (t) => await smaller(t.data)));

  const out = new Bytes();
  out.u32(SIGNATURE);
  out.u32(flavour);
  // The length of the whole file, which is not known until the end.
  const lengthAt = out.length;
  out.u32(0);
  out.u16(tables.length);
  out.u16(0);
  // What it unwraps to: the sfnt header, its directory, and every table padded
  // to four bytes. A browser uses this to allocate before it decompresses.
  out.u32(12 + tables.length * 16 + tables.reduce((n, t) => n + padded(t.data.length), 0));
  // The version of the *font*, which WOFF keeps its own copy of. Zero is the
  // honest answer: this editor writes no `head.fontRevision` to copy from.
  out.u16(0);
  out.u16(0);
  // No metadata block and no private block. Both are optional, and inventing
  // either would mean deciding what a font ought to say about itself.
  out.u32(0);
  out.u32(0);
  out.u32(0);
  out.u32(0);
  out.u32(0);

  // Where the tables begin, once the directory has been written.
  let at = HEADER + tables.length * RECORD;
  for (const [i, table] of tables.entries()) {
    const data = packed[i] ?? table.data;
    out.u32(tagOf(table.tag));
    out.u32(at);
    out.u32(data.length);
    out.u32(table.data.length);
    // Of the *original* table, not of what is written here: it is there so a
    // reader can check what it unwrapped, which is the original.
    out.u32(tableChecksum(table.data));
    at += padded(data.length);
  }

  for (const [i, table] of tables.entries()) {
    const data = packed[i] ?? table.data;
    out.bytes(data);
    // Every table starts on a four-byte boundary, and the padding is zeroes.
    for (let n = data.length; n < padded(data.length); n++) out.u8(0);
  }

  const bytes = out.done();
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(lengthAt, bytes.length);
  return bytes;
}

/** Whether these bytes are a WOFF file. */
export function isWoff(bytes: Uint8Array): boolean {
  return (
    bytes.length >= HEADER &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) === SIGNATURE
  );
}

/**
 * Unwrap a WOFF into the font inside it.
 *
 * The other direction of `toWoff`, for a WOFF opened here: the tables are
 * inflated and laid out as an ordinary font file, which is what everything that
 * reads a font past its outlines — the layout tables above all — needs in hand.
 * A table stored as it was, which the format marks by giving it the same length
 * both ways, is taken as it is.
 */
export async function fromWoff(woff: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  const flavour = view.getUint32(4);
  const count = view.getUint16(12);

  const tables: { tag: string; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER + i * RECORD;
    const tag = String.fromCharCode(...woff.subarray(at, at + 4));
    const offset = view.getUint32(at + 4);
    const compressed = view.getUint32(at + 8);
    const original = view.getUint32(at + 12);
    const stored = woff.subarray(offset, offset + compressed);
    const data = compressed === original ? stored : await inflate(stored);
    if (data === null) throw new Error(`the ${tag} table of this WOFF could not be unpacked`);
    tables.push({ tag, data });
  }
  return sfntOf(flavour, tables);
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  const Stream = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (Stream === undefined) return null;
  return await collect(new Stream("deflate"), data);
}

/**
 * A table, deflated — unless deflating made it bigger.
 *
 * Which happens, for the short ones: a `head` is 54 bytes and a zlib header is
 * 2 of them before anything is said. The format allows a table to be stored as
 * it is, and says how to tell: the compressed length equals the original.
 */
async function smaller(data: Uint8Array): Promise<Uint8Array> {
  const deflated = await deflate(data);
  return deflated === null || deflated.length >= data.length ? data : deflated;
}

/**
 * zlib, from the platform.
 *
 * `null` where there is no `CompressionStream` — an old browser, or a runtime
 * that is not one. The caller then stores the table, which makes a larger file
 * and a correct one.
 */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  const Stream = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (Stream === undefined) return null;

  // "deflate" rather than "deflate-raw": WOFF wants the zlib wrapper, which is
  // two bytes of header and four of checksum round the same compressed data.
  return await collect(new Stream("deflate"), data);
}

/** Everything a transform stream makes of some bytes, in one piece. */
async function collect(
  stream: CompressionStream | DecompressionStream,
  data: Uint8Array,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();

  // A fresh copy, because the stream is entitled to detach what it is handed
  // and a subarray shares its buffer with the whole font.
  const ignore = (): undefined => undefined;
  void writer.write(new Uint8Array(data)).catch(ignore);
  void writer.close().catch(ignore);

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
  }

  const size = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** The next four-byte boundary at or after `n`. */
const padded = (n: number): number => (n + 3) & ~3;

/** A four-character tag as the number the file writes. */
function tagOf(tag: string): number {
  return (
    ((tag.charCodeAt(0) << 24) |
      (tag.charCodeAt(1) << 16) |
      (tag.charCodeAt(2) << 8) |
      tag.charCodeAt(3)) >>>
    0
  );
}
