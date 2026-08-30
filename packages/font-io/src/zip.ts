/**
 * A minimal zip writer.
 *
 * Stored entries only — no compression. A UFO is a few kilobytes of XML per
 * glyph and the archive exists to carry a directory through a browser download,
 * not to save space. Deflate would mean either a dependency or an implementation
 * of a compression algorithm, to save a few hundred kilobytes on a file that is
 * about to be unzipped anyway.
 *
 * Written by hand rather than taken from a library because the stored-entry form
 * of the format is small and completely specified: a local header before each
 * file, a central directory listing them, and a record saying where that
 * directory starts.
 */

export type ZipEntry = {
  /** Path inside the archive, with forward slashes. */
  readonly path: string;
  readonly text: string;
};

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;

/** Version 2.0, which is what "stored or deflated, no encryption" needs. */
const VERSION = 20;

/**
 * CRC-32, as the zip format wants it.
 *
 * The table is built once on first use. Reversed polynomial 0xEDB88320, which is
 * the same CRC every zip tool checks entries against — a wrong one produces an
 * archive that opens and then reports every file as corrupt.
 */
let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table !== null) return table;

  const built = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    built[i] = c >>> 0;
  }
  table = built;
  return built;
}

export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = t[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Little-endian writer over a growing buffer. */
class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  get offset(): number {
    return this.length;
  }

  bytes(value: Uint8Array): void {
    this.parts.push(value);
    this.length += value.length;
  }

  u16(value: number): void {
    this.bytes(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.bytes(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/**
 * Build an archive from text files.
 *
 * Timestamps are written as a fixed 1980-01-01, the earliest the format can
 * express. A real clock would make two exports of an unchanged font differ,
 * which costs reproducibility and buys nothing — nothing here reads the date.
 */
export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const out = new Writer();
  const directory: Array<{
    path: Uint8Array;
    crc: number;
    size: number;
    offset: number;
  }> = [];

  for (const entry of entries) {
    const path = encoder.encode(entry.path);
    const data = encoder.encode(entry.text);
    const crc = crc32(data);
    const offset = out.offset;

    out.u32(LOCAL_HEADER);
    out.u16(VERSION);
    out.u16(0); // No flags. In particular, no data descriptor: sizes are known.
    out.u16(0); // Stored.
    out.u16(0); // Time.
    out.u16(0x0021); // Date: 1980-01-01.
    out.u32(crc);
    out.u32(data.length); // Compressed size, which for stored is the real one.
    out.u32(data.length);
    out.u16(path.length);
    out.u16(0); // No extra field.
    out.bytes(path);
    out.bytes(data);

    directory.push({ path, crc, size: data.length, offset });
  }

  const directoryStart = out.offset;
  for (const entry of directory) {
    out.u32(CENTRAL_HEADER);
    out.u16(VERSION); // Made by.
    out.u16(VERSION); // Needed to extract.
    out.u16(0);
    out.u16(0);
    out.u16(0);
    out.u16(0x0021);
    out.u32(entry.crc);
    out.u32(entry.size);
    out.u32(entry.size);
    out.u16(entry.path.length);
    out.u16(0); // Extra.
    out.u16(0); // Comment.
    out.u16(0); // Disk number.
    out.u16(0); // Internal attributes.
    out.u32(0); // External attributes.
    out.u32(entry.offset);
    out.bytes(entry.path);
  }
  const directoryLength = out.offset - directoryStart;

  out.u32(END_OF_DIRECTORY);
  out.u16(0); // This disk.
  out.u16(0); // Disk with the directory.
  out.u16(directory.length);
  out.u16(directory.length);
  out.u32(directoryLength);
  out.u32(directoryStart);
  out.u16(0); // No archive comment.

  return out.finish();
}
