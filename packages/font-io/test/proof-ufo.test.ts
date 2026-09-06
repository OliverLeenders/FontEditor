import {
  addAnchor,
  anchor,
  EMPTY_KERNING,
  type FontDocument,
  type Kerning,
  component,
  contour,
  counterIds,
  fontDocument,
  glyph,
  groupKey,
  kernIndex,
  kernValue,
  node,
  orderedGlyphs,
  setFeatures,
  setKern,
  setKernGroup,
  setKerning,
} from "@fonteditor/font-model";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { exportUfo, ufoFiles } from "../src/ufo.js";
import { importUfo } from "../src/ufo-import.js";

/**
 * The font the UFO check is run on, and the two ends of that check.
 *
 * A UFO that only this repository has ever read proves consistency, not
 * correctness — a misreading of the format shared by the writer and the reader
 * passes every test in here. So the same font goes out to `fontTools.ufoLib`,
 * the reference implementation everything in the type world is built on, and
 * comes back written in its hand.
 *
 * Both halves are ordinary tests that run in the suite. The two environment
 * variables are what `tools/ufo-check` sets to pass the font between them:
 * `UFO_OUT` says where to write it, `FOREIGN_UFO` points at the archive
 * fontTools wrote back.
 */

const OUT = process.env["UFO_OUT"] ?? "";
const FOREIGN = process.env["FOREIGN_UFO"] ?? "";

const ids = counterIds("proof");
const at = (x: number, y: number) => ({ x, y });

/** A ring of four smooth curves. */
const ring = (left: number, right: number, top: number, bottom: number) => {
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  const kx = (right - left) * 0.28;
  const ky = (top - bottom) * 0.28;
  return contour(
    ids.contour(),
    [
      node(ids.node(), at(midX, top), {
        type: "smooth",
        in: at(midX - kx, top),
        out: at(midX + kx, top),
      }),
      node(ids.node(), at(right, midY), {
        type: "smooth",
        in: at(right, midY + ky),
        out: at(right, midY - ky),
      }),
      node(ids.node(), at(midX, bottom), {
        type: "smooth",
        in: at(midX + kx, bottom),
        out: at(midX - kx, bottom),
      }),
      node(ids.node(), at(left, midY), {
        type: "smooth",
        in: at(left, midY - ky),
        out: at(left, midY + ky),
      }),
    ],
    true,
  );
};

/** Straight lines only, and two corners on fractional coordinates. */
const wedge = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), at(40, 0)),
      node(ids.node(), at(360.5, 0)),
      node(ids.node(), at(200.25, 700)),
    ],
    true,
  );

/** Left open on purpose: the format allows it and a reader has to cope. */
const openRun = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), at(60, 200), { out: at(160, 320) }),
      node(ids.node(), at(340, 200), { in: at(240, 320) }),
      node(ids.node(), at(420, 60)),
    ],
    false,
  );

/** One curve with only the outgoing handle set. */
const halfHandled = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), at(0, 0), { out: at(120, 240) }),
      node(ids.node(), at(400, 300)),
      node(ids.node(), at(400, 0)),
    ],
    true,
  );

const FEATURES = `languagesystem DFLT dflt;
languagesystem latn dflt;

feature liga {
    sub f i by fi;
} liga;

feature ss01 {
    sub a by a.alt;
} ss01;
`;

/**
 * Everything the UFO writer has a branch for, in one font.
 *
 * Curves and straight lines, an open contour, a half-handled segment, a
 * composite with an offset component, upper and lower case of the same letter —
 * whose files collide on a filesystem that does not care about case — a name
 * that has to be escaped, a glyph with no outline, fractional coordinates,
 * groups on both sides, a class pair, a glyph against a class, an exception,
 * and a feature file.
 */
function proof(): FontDocument {
  let kerning: Kerning = EMPTY_KERNING;
  kerning = setKernGroup(kerning, "first", "O", ["O", "o"]);
  kerning = setKernGroup(kerning, "first", "T", ["T"]);
  kerning = setKernGroup(kerning, "second", "A", ["A", "a"]);
  kerning = setKern(kerning, groupKey("O"), groupKey("A"), -18);
  kerning = setKern(kerning, groupKey("T"), groupKey("A"), -95);
  kerning = setKern(kerning, "T", "a", -110);
  kerning = setKern(kerning, "period", groupKey("A"), -40);

  const document = fontDocument(
    [
      glyph(".notdef", { advance: 500, contours: [wedge()] }),
      glyph("space", { unicodes: [0x20], advance: 260 }),
      // Anchors on both sides of an attachment, so a foreign reader is asked
      // about them too: `A` offers a place, `acute` attaches by one.
      addAnchor(
        glyph("A", { unicodes: [0x41], advance: 620, contours: [wedge()] }),
        anchor(ids.anchor(), "top", { x: 310, y: 720 }),
      ),
      glyph("a", { unicodes: [0x61], advance: 560, contours: [ring(60, 500, 520, 0)] }),
      glyph("a.alt", { advance: 560, contours: [halfHandled()] }),
      glyph("O", { unicodes: [0x4f], advance: 700, contours: [ring(50, 650, 720, -20)] }),
      glyph("o", { unicodes: [0x6f], advance: 580, contours: [ring(50, 530, 520, -10)] }),
      glyph("T", { unicodes: [0x54], advance: 600, contours: [wedge()] }),
      glyph("f", { unicodes: [0x66], advance: 340, contours: [openRun()] }),
      glyph("i", { unicodes: [0x69], advance: 280, contours: [wedge()] }),
      glyph("fi", { advance: 600, contours: [openRun(), wedge()] }),
      glyph("period", { unicodes: [0x2e], advance: 260, contours: [wedge()] }),
      addAnchor(
        glyph("acute", { unicodes: [0x2ca], advance: 0, contours: [wedge()] }),
        anchor(ids.anchor(), "_top", { x: 120, y: 460 }),
      ),
      glyph("Aacute", {
        unicodes: [0xc1],
        advance: 620,
        components: [
          component(ids.component(), "A"),
          component(ids.component(), "acute", {
            xScale: 1,
            xyScale: 0,
            yxScale: 0,
            yScale: 1,
            xOffset: 120,
            yOffset: 260,
          }),
        ],
      }),
      glyph("uni00A0.sc", { advance: 260 }),
    ],
    {
      familyName: "Tunni Proof",
      styleName: "Regular",
      unitsPerEm: 1000,
      ascender: 780,
      descender: -220,
      xHeight: 520,
      capHeight: 700,
    },
  );

  return setFeatures(setKerning(document, kerning), FEATURES);
}

describe("the proof font", () => {
  it("exports every file the check expects to find", () => {
    const paths = new Set(ufoFiles(proof()).map((f) => f.path));

    expect(paths.has("metainfo.plist")).toBe(true);
    expect(paths.has("fontinfo.plist")).toBe(true);
    expect(paths.has("layercontents.plist")).toBe(true);
    expect(paths.has("glyphs/contents.plist")).toBe(true);
    expect(paths.has("lib.plist")).toBe(true);
    expect(paths.has("groups.plist")).toBe(true);
    expect(paths.has("kerning.plist")).toBe(true);
    expect(paths.has("features.fea")).toBe(true);
    // Upper and lower case of one letter, in files that do not collide on a
    // filesystem that does not care which is which.
    expect(paths.has("glyphs/A_.glif")).toBe(true);
    expect(paths.has("glyphs/a.glif")).toBe(true);
  });

  it("writes itself out when asked to", () => {
    if (OUT === "") return;

    const out = exportUfo(proof());
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });

    // The zip a browser is handed, and the folder it unzips to. The folder is
    // what another tool opens.
    writeFileSync(join(OUT, out.fileName), out.bytes);
    const root = join(OUT, out.fileName.replace(/\.zip$/, ""));
    for (const entry of ufoFiles(proof())) {
      const path = join(root, entry.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, entry.text, "utf8");
    }
  });

  it("comes back from fontTools unchanged", async () => {
    if (FOREIGN === "") return;

    const file = readFileSync(FOREIGN);
    const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

    const read = await importUfo(source, counterIds("back"));
    if ("reason" in read) throw new Error(read.reason);

    const before = proof();
    const after = read.document;

    // Nothing to explain away: a warning here is the reader saying it did not
    // understand something the reference implementation wrote.
    expect(read.warnings).toEqual([]);

    expect(after.info).toEqual(before.info);
    expect(after.glyphOrder).toEqual(before.glyphOrder);

    const shape = (d: FontDocument) =>
      orderedGlyphs(d).map((g) => ({
        name: g.name,
        advance: g.advance,
        unicodes: [...g.unicodes],
        contours: g.contours.length,
        nodes: g.contours.map((c) => c.nodes.length),
        closed: g.contours.map((c) => c.closed),
        components: g.components.map((c) => c.base),
        // By name and position: an anchor that came back as a one-point contour
        // would pass every other line here.
        anchors: g.anchors.map((a) => [a.name, a.pt.x, a.pt.y]),
      }));
    expect(shape(after)).toEqual(shape(before));

    expect(after.kerning.firstGroups).toEqual(before.kerning.firstGroups);
    expect(after.kerning.secondGroups).toEqual(before.kerning.secondGroups);

    // By what the pairs do rather than by how they are written: the value a
    // designer sees is the thing that has to survive.
    const was = kernIndex(before.kerning);
    const now = kernIndex(after.kerning);
    for (const [left, right] of [
      ["O", "A"],
      ["o", "a"],
      ["T", "A"],
      ["T", "a"],
      ["period", "A"],
      ["A", "O"],
    ] as const) {
      expect(kernValue(now, left, right)).toBe(kernValue(was, left, right));
    }

    expect(after.features.trim()).toBe(before.features.trim());
  });
});
