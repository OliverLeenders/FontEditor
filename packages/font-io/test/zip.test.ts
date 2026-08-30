import { describe, expect, it } from "vitest";

import { crc32, zip } from "../src/zip.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const u16 = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number): number =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/**
 * Read a stored-entry archive back.
 *
 * Walks the local headers rather than the central directory, so it checks the
 * part an unzipper actually streams — and would notice a size or name length
 * that disagreed with the bytes that follow it.
 */
function unzip(archive: Uint8Array): Map<string, string> {
  const decoder = new TextDecoder();
  const out = new Map<string, string>();
  let at = 0;

  while (at + 4 <= archive.length && u32(archive, at) === 0x04034b50) {
    const nameLength = u16(archive, at + 26);
    const extraLength = u16(archive, at + 28);
    const size = u32(archive, at + 22);
    const nameAt = at + 30;
    const dataAt = nameAt + nameLength + extraLength;

    out.set(
      decoder.decode(archive.subarray(nameAt, nameAt + nameLength)),
      decoder.decode(archive.subarray(dataAt, dataAt + size)),
    );
    at = dataAt + size;
  }
  return out;
}

describe("crc32", () => {
  // Anchored to published vectors, not to our own output: a self-consistent but
  // wrong CRC produces an archive that opens and then reports every file inside
  // it as corrupt.
  it("matches the known values for the standard polynomial", () => {
    expect(crc32(bytes(""))).toBe(0x00000000);
    expect(crc32(bytes("a"))).toBe(0xe8b7be43);
    expect(crc32(bytes("abc"))).toBe(0x352441c2);
    expect(crc32(bytes("hello"))).toBe(0x3610a686);
    expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("returns an unsigned value", () => {
    expect(crc32(bytes("a"))).toBeGreaterThan(0);
  });
});

describe("zip", () => {
  const sample = [
    { path: "metainfo.plist", text: "<plist/>" },
    { path: "glyphs/o.glif", text: "<glyph name=\"o\"/>" },
    { path: "glyphs/A_.glif", text: "<glyph name=\"A\"/>" },
  ];

  it("starts with a local file header", () => {
    expect(u32(zip(sample), 0)).toBe(0x04034b50);
  });

  it("round-trips every entry, path and contents intact", () => {
    const back = unzip(zip(sample));
    expect([...back.keys()]).toEqual(["metainfo.plist", "glyphs/o.glif", "glyphs/A_.glif"]);
    expect(back.get("glyphs/o.glif")).toBe('<glyph name="o"/>');
  });

  it("records a correct CRC for each entry", () => {
    const archive = zip([{ path: "a.txt", text: "hello" }]);
    expect(u32(archive, 14)).toBe(0x3610a686);
  });

  it("stores rather than compresses, so the two sizes agree", () => {
    const archive = zip([{ path: "a.txt", text: "hello" }]);
    expect(u16(archive, 8)).toBe(0); // method 0 = stored
    expect(u32(archive, 18)).toBe(5); // compressed
    expect(u32(archive, 22)).toBe(5); // uncompressed
  });

  it("ends with a directory record naming every entry", () => {
    const archive = zip(sample);
    const end = archive.length - 22;
    expect(u32(archive, end)).toBe(0x06054b50);
    expect(u16(archive, end + 8)).toBe(3);
    expect(u16(archive, end + 10)).toBe(3);

    // The offset it gives must actually land on the central directory.
    const start = u32(archive, end + 16);
    expect(u32(archive, start)).toBe(0x02014b50);
  });

  it("points each directory entry at its own local header", () => {
    const archive = zip(sample);
    const end = archive.length - 22;
    let at = u32(archive, end + 16);

    for (let i = 0; i < 3; i++) {
      expect(u32(archive, at)).toBe(0x02014b50);
      const localAt = u32(archive, at + 42);
      expect(u32(archive, localAt)).toBe(0x04034b50);
      at += 46 + u16(archive, at + 28) + u16(archive, at + 30) + u16(archive, at + 32);
    }
  });

  it("writes an empty but valid archive for no entries", () => {
    const archive = zip([]);
    expect(archive.length).toBe(22);
    expect(u32(archive, 0)).toBe(0x06054b50);
  });

  it("handles non-ASCII paths and contents as UTF-8", () => {
    const back = unzip(zip([{ path: "glyphs/Ω.glif", text: "ø∫∆" }]));
    expect(back.get("glyphs/Ω.glif")).toBe("ø∫∆");
  });

  it("is reproducible: the same input gives the same bytes", () => {
    // No clock in the archive, so an unchanged font exports identically.
    expect(zip(sample)).toEqual(zip(sample));
  });
});
