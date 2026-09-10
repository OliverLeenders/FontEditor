import {
  DEFAULT_FONT_INFO,
  addContour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
} from "@typewright/font-model";
import { vec } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { readTablesOf, tableChecksum } from "../src/sfnt.js";
import { exportTrueType } from "../src/truetype.js";
import { toWoff } from "../src/woff.js";
import { toWoff2 } from "../src/woff2.js";

/**
 * A font wrapped for the web.
 *
 * Neither format changes the drawing: they are the same tables behind a header
 * that says how big each was before it was squeezed. So what is worth asking
 * here is that the wrapping is right — that a reader can find every table, and
 * that unwrapping one gives back exactly the bytes that went in.
 */

const ids = counterIds("woff");

/** A font with enough in it that compressing is worth something. */
function font() {
  const drawn = addContour(
    glyph("n", { advance: 560, unicodes: [0x6e] }),
    contour(
      ids.contour(),
      [
        node(ids.node(), vec(60, 0)),
        node(ids.node(), vec(360, 0)),
        node(ids.node(), vec(360, 700), { in: vec(360, 600) }),
        node(ids.node(), vec(60, 700)),
      ],
      true,
    ),
  );

  return fontDocument([glyph(".notdef", { advance: 500 }), drawn], {
    ...DEFAULT_FONT_INFO,
    familyName: "Web",
    styleName: "Regular",
  });
}

/** The header, read back the way a browser would read it. */
function headerOf(woff: Uint8Array) {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  return {
    signature: String.fromCharCode(woff[0]!, woff[1]!, woff[2]!, woff[3]!),
    flavour: view.getUint32(4),
    length: view.getUint32(8),
    numTables: view.getUint16(12),
    totalSfntSize: view.getUint32(16),
  };
}

/** Every table entry of a WOFF, as its directory gives them. */
function directoryOf(woff: Uint8Array) {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  const out = [];
  for (let i = 0; i < view.getUint16(12); i++) {
    const at = 44 + i * 20;
    out.push({
      tag: String.fromCharCode(woff[at]!, woff[at + 1]!, woff[at + 2]!, woff[at + 3]!),
      offset: view.getUint32(at + 4),
      compLength: view.getUint32(at + 8),
      origLength: view.getUint32(at + 12),
      checksum: view.getUint32(at + 16),
    });
  }
  return out;
}

/** Unwrap one table, the way the format says to tell stored from deflated. */
async function tableBytes(
  woff: Uint8Array,
  entry: { offset: number; compLength: number; origLength: number },
): Promise<Uint8Array> {
  const raw = woff.subarray(entry.offset, entry.offset + entry.compLength);
  if (entry.compLength === entry.origLength) return raw;

  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  void writer.write(new Uint8Array(raw));
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

describe("WOFF", () => {
  it("is a wOFF that says what it unwraps to", async () => {
    const otf = new Uint8Array(exportFont(font()).bytes);
    const woff = await toWoff(otf);
    const head = headerOf(woff);

    expect(head.signature).toBe("wOFF");
    expect(head.length).toBe(woff.length);
    expect(head.numTables).toBe(readTablesOf(otf).length);
    // The flavour is the sfnt version it came from, so a browser knows whether
    // it is unwrapping an OTF or a TTF before it starts.
    expect(head.flavour).toBe(new DataView(otf.buffer, otf.byteOffset).getUint32(0));
    expect(head.totalSfntSize).toBeGreaterThan(0);
  });

  it("gives every table back exactly, byte for byte", async () => {
    const otf = new Uint8Array(exportFont(font()).bytes);
    const woff = await toWoff(otf);

    const original = new Map(readTablesOf(otf).map((t) => [t.tag, t.data]));
    expect(directoryOf(woff)).toHaveLength(original.size);

    for (const entry of directoryOf(woff)) {
      const was = original.get(entry.tag);
      expect(was, `no ${entry.tag} in the font it was made from`).toBeDefined();
      expect(entry.origLength).toBe(was!.length);
      // The checksum is of the original table, so a reader can check what it
      // unwrapped rather than what it unwrapped from.
      expect(entry.checksum).toBe(tableChecksum(was!));
      expect([...(await tableBytes(woff, entry))]).toEqual([...was!]);
    }
  });

  it("starts every table on a four-byte boundary", async () => {
    const woff = await toWoff(new Uint8Array(exportFont(font()).bytes));
    for (const entry of directoryOf(woff)) expect(entry.offset % 4).toBe(0);
  });

  it("stores a table rather than growing it", async () => {
    // A `head` is 54 bytes and a zlib wrapper is six before anything is said,
    // so the short tables come out stored. The format says how to tell: the
    // compressed length equals the original.
    const woff = await toWoff(new Uint8Array(exportFont(font()).bytes));
    for (const entry of directoryOf(woff)) {
      expect(entry.compLength).toBeLessThanOrEqual(entry.origLength);
    }
  });

  it("wraps a TrueType flavour as readily as a CFF one", async () => {
    const ttf = new Uint8Array(exportTrueType(font()).bytes);
    const woff = await toWoff(ttf);

    expect(headerOf(woff).flavour).toBe(0x00010000);
    expect(directoryOf(woff).some((e) => e.tag === "glyf")).toBe(true);
  });
});

describe("WOFF2", () => {
  it("is a wOF2 smaller than the font it was made from", async () => {
    const otf = new Uint8Array(exportFont(font()).bytes);
    const out = await toWoff2(otf);

    expect(String.fromCharCode(...out.bytes.subarray(0, 4))).toBe("wOF2");
    expect(out.bytes.length).toBeLessThan(otf.length);
    expect(out.saved).toBeGreaterThan(0);
  });

  it("unwraps back to the font that went in", async () => {
    // The one thing worth proving about somebody else's encoder: that what it
    // wrote is what it will read, and that the tables survive the transform.
    const { decompress } = await import("woff2-encoder");
    const ttf = new Uint8Array(exportTrueType(font()).bytes);

    const back = await decompress((await toWoff2(ttf)).bytes);
    const tags = readTablesOf(back).map((t) => t.tag);

    expect(tags).toContain("glyf");
    expect(tags).toContain("cmap");
    expect(tags).toContain("head");
  });

  it("beats WOFF on the same font, which is the reason it exists", async () => {
    const ttf = new Uint8Array(exportTrueType(font()).bytes);
    const one = await toWoff(ttf);
    const two = await toWoff2(ttf);

    expect(two.bytes.length).toBeLessThan(one.length);
  });
});
