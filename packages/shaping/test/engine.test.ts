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

import { type TextSettings, READ_FROM_TEXT, harfBuzzEngine } from "../src/index.js";

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
    // Two letters that run the other way, and a pair that faces about with them.
    glyph("alef", { unicodes: [0x627], advance: 300, contours: [drawn()] }),
    glyph("beh", { unicodes: [0x628], advance: 400, contours: [drawn()] }),
    glyph("parenleft", { unicodes: [0x28], advance: 200, contours: [drawn()] }),
    glyph("parenright", { unicodes: [0x29], advance: 200, contours: [drawn()] }),
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

/**
 * Text that runs the other way.
 *
 * The glyphs come back in the order they are drawn — left to right, whatever
 * the text does — so what is asked of each of these is the order of the names.
 */
describe("a line that is not all one direction", () => {
  const ALEF = "ا";
  const BEH = "ب";

  const names = (text: string, settings: TextSettings = READ_FROM_TEXT) =>
    (harfBuzzEngine(font(), settings)(textTokens(text)) ?? []).map((g) => g.name);

  it("leaves a line that runs one way as it was written", () => {
    expect(names("AV")).toEqual(["A", "V"]);
  });

  it("draws a right-to-left line from the right", () => {
    // Written alef then beh; drawn beh then alef, which is the same thing said
    // from the other end.
    expect(names(ALEF + BEH)).toEqual(["beh", "alef"]);
  });

  it("keeps a left-to-right phrase inside it reading its own way", () => {
    expect(names(ALEF + "AV" + BEH)).toEqual(["beh", "A", "V", "alef"]);
  });

  it("takes the direction it is given rather than reading it from the text", () => {
    // The A comes first in the text, so the line is read left to right unless
    // somebody says otherwise — which is what the control in the bar is for.
    expect(names("A" + ALEF)).toEqual(["A", "alef"]);
    expect(names("A" + ALEF, { ...READ_FROM_TEXT, direction: "rtl" })).toEqual(["alef", "A"]);
    expect(names(ALEF + "A", { ...READ_FROM_TEXT, direction: "ltr" })).toEqual(["alef", "A"]);
  });

  it("faces a bracket the other way in right-to-left text", () => {
    // The one that opens is the one on the right, so the glyph set for "(" is
    // the other member of the pair.
    expect(names(ALEF + "(")).toEqual(["parenright", "alef"]);
    expect(names(ALEF + "(", { ...READ_FROM_TEXT, direction: "ltr" })).toEqual([
      "alef",
      "parenleft",
    ]);
  });

  it("keeps one engine per settings, and the same one for the same settings", () => {
    const document = font();
    const rtl: TextSettings = { direction: "rtl", script: "arab", language: null, features: {} };

    expect(harfBuzzEngine(document, rtl)).toBe(harfBuzzEngine(document, { ...rtl }));
    expect(harfBuzzEngine(document, rtl)).not.toBe(harfBuzzEngine(document));
    expect(harfBuzzEngine(document)).toBe(harfBuzzEngine(document, READ_FROM_TEXT));
  });

  it("keeps a separate engine for a line set with a feature switched", () => {
    const document = font();
    const withSet: TextSettings = { ...READ_FROM_TEXT, features: { ss01: true } };

    expect(harfBuzzEngine(document, withSet)).not.toBe(harfBuzzEngine(document));
    expect(harfBuzzEngine(document, withSet)).toBe(
      harfBuzzEngine(document, { ...READ_FROM_TEXT, features: { ss01: true } }),
    );
  });
});

/**
 * The features a line is set with, which is the whole reason the bars have
 * switches: a stylistic set is off until something asks for it, and nothing in
 * this editor could ask until these were passed through.
 */
describe("the features a line is set with", () => {
  /** The same font, with a stylistic set that swaps `A` for `V`. */
  function withStylisticSet(): FontDocument {
    const base = font();
    return {
      ...base,
      features: `${base.features}feature ss01 {\n  sub A by V;\n} ss01;\n`,
    };
  }

  const names = (document: FontDocument, text: string, settings: TextSettings) =>
    (harfBuzzEngine(document, settings)(textTokens(text)) ?? []).map((g) => g.name);

  it("leaves a stylistic set alone until it is asked for", () => {
    expect(names(withStylisticSet(), "A", READ_FROM_TEXT)).toEqual(["A"]);
  });

  it("applies one that is switched on", () => {
    const on: TextSettings = { ...READ_FROM_TEXT, features: { ss01: true } };
    expect(names(withStylisticSet(), "A", on)).toEqual(["V"]);
  });

  it("silences one a renderer would have applied", () => {
    const off: TextSettings = { ...READ_FROM_TEXT, features: { liga: false } };
    expect(names(font(), "fi", off)).toEqual(["f", "i"]);
  });
});
