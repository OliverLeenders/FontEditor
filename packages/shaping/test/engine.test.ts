import {
  type FontDocument,
  EMPTY_KERNING,
  anchor,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  setKern,
  setKerning,
  textTokens,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { harfBuzzEngine } from "../src/index.js";

/**
 * Text set by HarfBuzz itself, from the font this editor compiles.
 *
 * Not a stand-in: the real WebAssembly build, given a small font with a
 * ligature, a kerning pair and an accent with anchors, and asked what it sets.
 */

const ids = counterIds("hb");

/** A small triangle, so every glyph has something drawn. */
const drawn = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: 10, y: 0 }),
      node(ids.node(), { x: 5, y: 10 }),
    ],
    true,
  );

function font(): FontDocument {
  const base = fontDocument([
    glyph("A", { unicodes: [0x41], advance: 600, contours: [drawn()] }),
    glyph("V", { unicodes: [0x56], advance: 600, contours: [drawn()] }),
    glyph("f", { unicodes: [0x66], advance: 300, contours: [drawn()] }),
    glyph("i", { unicodes: [0x69], advance: 250, contours: [drawn()] }),
    glyph("f_i", { advance: 520, contours: [drawn()] }),
    glyph("e", {
      unicodes: [0x65],
      advance: 500,
      contours: [drawn()],
      anchors: [anchor(ids.anchor(), "top", { x: 250, y: 520 })],
    }),
    glyph("acutecomb", {
      unicodes: [0x301],
      advance: 0,
      contours: [drawn()],
      anchors: [anchor(ids.anchor(), "_top", { x: 100, y: 480 })],
    }),
  ]);
  return setKerning(
    { ...base, features: "feature liga {\n  sub f i by f_i;\n} liga;\n" },
    setKern(EMPTY_KERNING, "A", "V", -80),
  );
}

const set = (document: FontDocument, text: string) =>
  harfBuzzEngine(document)(textTokens(text)) ?? [];

describe("HarfBuzz setting a line", () => {
  it("applies the font's ligatures", () => {
    expect(set(font(), "fi").map((g) => g.name)).toEqual(["f_i"]);
  });

  it("applies the kerning, in the first glyph's advance", () => {
    expect(set(font(), "AV")[0]).toMatchObject({ name: "A", xAdvance: 520 });
  });

  it("puts an accent on its letter by their anchors", () => {
    // The mark's origin is after the e's advance, at 500; its _top is 100 in,
    // and the e's top is at 250. So it moves back 350, and up by 520 - 480.
    expect(set(font(), "é")[1]).toMatchObject({
      name: "acutecomb",
      xOffset: -350,
      yOffset: 40,
    });
  });

  it("sets a glyph named after a slash, which has no character of its own", () => {
    expect(set(font(), "A/f_i V").map((g) => g.name)).toEqual(["A", "f_i", "V"]);
  });

  it("leaves out a character the font has no glyph for, and a name it has not got", () => {
    expect(set(font(), "AzV/nothing").map((g) => g.name)).toEqual(["A", "V"]);
  });

  it("gives the same engine for the same document, and a new one after an edit", () => {
    const document = font();
    expect(harfBuzzEngine(document)).toBe(harfBuzzEngine(document));
    expect(harfBuzzEngine({ ...document })).not.toBe(harfBuzzEngine(document));
  });
});
