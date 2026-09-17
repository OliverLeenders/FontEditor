import {
  BACKGROUND,
  addContour,
  addLayer,
  contour,
  copyToLayer,
  counterIds,
  fontDocument,
  glyph,
  horizontalGuide,
  node,
  setGuides,
  setKept,
  setLayers,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { StorageClient } from "../src/client.js";
import { MemoryFileStore } from "../src/file-store.js";
import { loadDocument, saveDocument } from "../src/project.js";
import { decodeGlyph, encodeFontInfo, encodeGlyph } from "../src/schema.js";
import { documentOf, snapshotOf } from "../src/snapshots.js";
import { FakeWorker } from "./fake-worker.js";

/**
 * Layers, now that they are part of the document: each glyph's drawings in its
 * own file, and the font's list of layers with its information.
 *
 * Every place a document is taken apart and put back together is asked, since
 * each is a place a field can be left behind — and one of them was leaving the
 * font's guides and what its file carried unread behind already.
 */

const ids = counterIds("ld");
const stem = (width: number) =>
  contour(
    ids.contour(),
    [node(ids.node(), { x: 0, y: 0 }), node(ids.node(), { x: width, y: 700 })],
    true,
  );

function layered() {
  const letter = copyToLayer(addContour(glyph("n", { advance: 500 }), stem(60)), BACKGROUND);
  let document = addLayer(fontDocument([letter, glyph("space", { advance: 250 })]), BACKGROUND);
  document = setLayers(document, [
    ...document.layers,
    {
      name: "sketch",
      directory: "glyphs.sketch",
      info: "<plist><dict/></plist>",
      orphans: [{ name: "x", path: "x.glif", text: '<glyph name="x"/>' }],
    },
  ]);
  document = setGuides(document, [horizontalGuide(ids.guide(), 512, "x-height")]);
  return setKept(document, { fontInfo: { openTypeNameVersion: "1.0" }, lib: { "com.x": 1 } });
}

describe("a glyph's layers", () => {
  it("are encoded with the glyph and decoded back", () => {
    const g = layered().glyphs["n"]!;
    const decoded = decodeGlyph(JSON.parse(JSON.stringify(encodeGlyph(g))) as unknown);
    expect(decoded.ok && decoded.value).toEqual(g);
  });

  it("are not written for a glyph drawn once", () => {
    expect("layers" in { ...encodeGlyph(glyph("a")) }).toBe(false);
    expect("layers" in { ...encodeFontInfo(fontDocument()) }).toBe(false);
  });
});

describe("the whole document", () => {
  it("comes back from the project's files", async () => {
    const store = new MemoryFileStore();
    const before = layered();
    await saveDocument(store, before);
    const read = await loadDocument(store);
    expect(read.kind === "loaded" && read.document).toEqual(before);
  });

  it("comes back from a snapshot", () => {
    const before = layered();
    expect(documentOf(JSON.parse(JSON.stringify(snapshotOf(before, 1))) as never).document).toEqual(
      before,
    );
  });

  it("comes back across the worker, guides and what the file carried included", async () => {
    const worker = new FakeWorker();
    const client = new StorageClient(worker as unknown as Worker);
    await client.open("project");
    const before = layered();

    await client.replaceAll(before);
    const loaded = await client.load();
    expect(loaded.kind === "loaded" && loaded.document).toEqual(before);
  });
});
