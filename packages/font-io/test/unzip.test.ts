import { counterIds, fontDocument, glyph } from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { exportUfo } from "../src/ufo.js";
import { importUfo } from "../src/ufo-import.js";
import { type ZipFile, fileText, unzip } from "../src/unzip.js";
import { crc32 } from "../src/zip.js";

/**
 * Reading an archive somebody else wrote.
 *
 * Our own exports store their entries rather than compressing them, so every
 * test that went through `unzip` before this one took the easy branch. A UFO
 * that arrives from Glyphs or RoboFont is deflated, which is the branch a real
 * user's first file would land on — and it had never run.
 *
 * The archives here are built byte by byte rather than by our writer, for the
 * same reason: a writer and a reader that agree with each other prove nothing
 * about the format.
 */

const STORED = 0;
const DEFLATED = 8;

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Compress the way every other zip writer does. */
async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  void writer.write(raw);
  void writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
  }

  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

type Entry = {
  readonly path: string;
  /** What the file says, before compression. */
  readonly content: Uint8Array;
  readonly method: number;
  /** What actually goes in the archive; the same bytes unless deflated. */
  readonly stored: Uint8Array;
  /** Extra field on the local header only, which the two are allowed to differ in. */
  readonly localExtra?: number;
};

async function entry(path: string, content: string, method = DEFLATED, localExtra = 0) {
  const raw = text(content);
  return {
    path,
    content: raw,
    method,
    stored: method === DEFLATED ? await deflate(raw) : raw,
    localExtra,
  };
}

/**
 * An archive, written by hand.
 *
 * Local headers, then a central directory, then the end record — the layout
 * every zip has, with the numbers put in one at a time so a test can put a wrong
 * one in on purpose.
 */
function archive(entries: readonly Entry[], comment = ""): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  const offsets: number[] = [];
  let at = 0;

  for (const one of entries) {
    const name = encoder.encode(one.path);
    const extra = new Uint8Array(one.localExtra ?? 0);
    const header = new Uint8Array(30 + name.length + extra.length + one.stored.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, one.method, true);
    view.setUint32(14, crc32(one.content), true);
    view.setUint32(18, one.stored.length, true);
    view.setUint32(22, one.content.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, extra.length, true);
    header.set(name, 30);
    header.set(extra, 30 + name.length);
    header.set(one.stored, 30 + name.length + extra.length);

    offsets.push(at);
    at += header.length;
    locals.push(header);
  }

  for (const [index, one] of entries.entries()) {
    const name = encoder.encode(one.path);
    const record = new Uint8Array(46 + name.length);
    const view = new DataView(record.buffer);

    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(10, one.method, true);
    view.setUint32(16, crc32(one.content), true);
    view.setUint32(20, one.stored.length, true);
    view.setUint32(24, one.content.length, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, offsets[index]!, true);
    record.set(name, 46);

    directory.push(record);
  }

  const directorySize = directory.reduce((n, d) => n + d.length, 0);
  const tail = encoder.encode(comment);
  const end = new Uint8Array(22 + tail.length);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, at, true);
  endView.setUint16(20, tail.length, true);
  end.set(tail, 22);

  const total = at + directorySize + end.length;
  const out = new Uint8Array(total);
  let write = 0;
  for (const part of [...locals, ...directory, end]) {
    out.set(part, write);
    write += part.length;
  }
  return out.buffer;
}

const found = (files: ZipFile[] | { reason: string }): ZipFile[] => {
  if (!Array.isArray(files)) throw new Error(`expected files, got: ${files.reason}`);
  return files;
};

describe("reading a deflated archive", () => {
  it("gives back what was compressed", async () => {
    const one = await entry("fontinfo.plist", "<plist><dict/></plist>");
    const files = found(await unzip(archive([one])));

    expect(files).toHaveLength(1);
    expect(fileText(files, "fontinfo.plist")).toBe("<plist><dict/></plist>");
  });

  it("gives back content long enough to actually compress", async () => {
    // A short string deflates to more than it started as, so the short cases
    // above do not prove the inflater ever did any work.
    const long = "<point x='10' y='20' type='curve'/>".repeat(500);
    const files = found(await unzip(archive([await entry("a.glif", long)])));

    expect(fileText(files, "a.glif")).toBe(long);
    expect(fileText(files, "a.glif")?.length).toBe(long.length);
  });

  it("reads an archive that mixes the two methods", async () => {
    // Real writers store what does not compress and deflate what does, so both
    // branches run over one file.
    const files = found(
      await unzip(
        archive([
          await entry("stored.txt", "kept as it is", STORED),
          await entry("packed.txt", "squeezed".repeat(50), DEFLATED),
        ]),
      ),
    );

    expect(fileText(files, "stored.txt")).toBe("kept as it is");
    expect(fileText(files, "packed.txt")).toBe("squeezed".repeat(50));
  });

  it("keeps non-ASCII paths and contents intact", async () => {
    const files = found(await unzip(archive([await entry("glyphs/Ω.glif", "ø∫∆".repeat(40))])));
    expect(fileText(files, "glyphs/Ω.glif")).toBe("ø∫∆".repeat(40));
  });

  it("finds the data when the local header carries an extra field", async () => {
    // The two headers are allowed to disagree about the extra field, and the
    // data starts after the local one. Reading the directory's length instead
    // would land a few bytes into the file.
    const files = found(
      await unzip(archive([await entry("a.txt", "after the extra".repeat(20), DEFLATED, 17)])),
    );
    expect(fileText(files, "a.txt")).toBe("after the extra".repeat(20));
  });

  it("skips the directory entries other writers put in", async () => {
    const files = found(
      await unzip(
        archive([
          await entry("Font.ufo/", "", STORED),
          await entry("Font.ufo/metainfo.plist", "<plist/>".repeat(30)),
        ]),
      ),
    );

    expect(files.map((f) => f.path)).toEqual(["Font.ufo/metainfo.plist"]);
  });

  it("finds the end record behind an archive comment", async () => {
    const files = found(
      await unzip(archive([await entry("a.txt", "x".repeat(200))], "Written by something else")),
    );
    expect(fileText(files, "a.txt")).toBe("x".repeat(200));
  });
});

describe("a deflated UFO, end to end", () => {
  it("imports the same font that was exported", async () => {
    const ids = counterIds("z");
    const document = fontDocument([
      glyph("A", { unicodes: [0x41], advance: 620 }),
      glyph("space", { unicodes: [0x20], advance: 250 }),
    ]);

    // Our own export, taken apart and packed again the way another tool would
    // pack it. Nothing about the UFO changes; only how it is carried.
    const stored = found(await unzip(exportUfo(document).bytes.buffer as ArrayBuffer));
    const packed = archive(
      await Promise.all(
        stored.map(async (file) => ({
          path: file.path,
          content: file.bytes,
          method: DEFLATED,
          stored: await deflate(file.bytes),
        })),
      ),
    );

    const back = await importUfo(packed, ids);
    if ("reason" in back) throw new Error(back.reason);

    expect(Object.keys(back.document.glyphs).sort()).toEqual(["A", "space"]);
    expect(back.document.glyphs["A"]?.advance).toBe(620);
  });
});

describe("an archive that cannot be read", () => {
  it("says so rather than throwing when the compressed data is nonsense", async () => {
    const one = await entry("a.txt", "hello".repeat(50));
    // Deflate data is checksummed; flipping bytes in the middle of it makes a
    // stream that ends in an error rather than in bytes.
    const broken = { ...one, stored: one.stored.map((b, i) => (i > 2 ? b ^ 0xff : b)) };

    const files = await unzip(archive([broken]));
    expect(Array.isArray(files)).toBe(false);
    expect((files as { reason: string }).reason).toContain("could not be decompressed");
  });

  it("names the method it does not know", async () => {
    // 12 is bzip2. Refusing is the point: taking the bytes as they are would
    // hand back a plist of noise.
    const files = await unzip(archive([await entry("a.txt", "content", 12)]));
    expect((files as { reason: string }).reason).toContain("unsupported compression method");
  });

  it("says what is wrong with something that is not a zip", async () => {
    const files = await unzip(text("not an archive at all").buffer as ArrayBuffer);
    expect((files as { reason: string }).reason).toContain("no end-of-directory record");
  });

  it("says so when the directory does not start where the end record says", async () => {
    const bytes = new Uint8Array(archive([await entry("a.txt", "x".repeat(100))]));
    const view = new DataView(bytes.buffer);
    // Point the directory at the middle of the file data instead.
    const end = bytes.length - 22;
    view.setUint32(end + 16, 40, true);

    const files = await unzip(bytes.buffer);
    expect((files as { reason: string }).reason).toContain("central directory is malformed");
  });

  it("says so when the directory runs off the end", async () => {
    const bytes = new Uint8Array(archive([await entry("a.txt", "x".repeat(100))]));
    const view = new DataView(bytes.buffer);
    view.setUint32(bytes.length - 22 + 16, bytes.length - 4, true);

    const files = await unzip(bytes.buffer);
    expect((files as { reason: string }).reason).toContain("runs past the end");
  });

  it("says so when an entry points outside the archive", async () => {
    const bytes = new Uint8Array(archive([await entry("a.txt", "x".repeat(100))]));
    const view = new DataView(bytes.buffer);
    const directoryAt = view.getUint32(bytes.length - 22 + 16, true);
    view.setUint32(directoryAt + 42, bytes.length + 1000, true);

    const files = await unzip(bytes.buffer);
    expect((files as { reason: string }).reason).toContain("points outside the archive");
  });
});
