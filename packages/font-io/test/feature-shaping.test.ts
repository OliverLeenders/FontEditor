import {
  DEFAULT_FONT_INFO,
  anchor,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  setFeatures,
} from "@typewright/font-model";
import { Blob, Buffer, Face, Feature, Font, shape } from "harfbuzzjs";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";

/**
 * Feature files, compiled here and set by HarfBuzz.
 *
 * The byte-level tests beside this check that the tables have the shape the
 * specification describes. This checks what matters to anybody using the font:
 * that text set with it comes out as the feature file says. HarfBuzz is the
 * shaper browsers and operating systems use, and it did not write these tables,
 * so agreeing with it is agreeing with something other than ourselves.
 */

const ids = counterIds("hb");

const drawn = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: 100, y: 0 }),
      node(ids.node(), { x: 50, y: 100 }),
    ],
    true,
  );

/** Glyph names, and the character each is typed as, if any. */
const GLYPHS: readonly (readonly [string, number | null])[] = [
  ["a", 0x61],
  ["b", 0x62],
  ["c", 0x63],
  ["f", 0x66],
  ["i", 0x69],
  ["o", 0x6f],
  ["T", 0x54],
  ["f_i", null],
  ["a.sc", null],
  ["b.sc", null],
  ["a.alt1", null],
  ["a.alt2", null],
  ["i.TRK", null],
];

const INFO = { ...DEFAULT_FONT_INFO, familyName: "Shaping Test", unitsPerEm: 1000 };

/** A font with these features, open in HarfBuzz. */
function fontWith(features: string, extra: ReturnType<typeof glyph>[] = []): Font {
  const glyphs = [
    glyph(".notdef", { advance: 500 }),
    ...GLYPHS.map(([name, code]) =>
      glyph(name, { unicodes: code === null ? [] : [code], advance: 500, contours: [drawn()] }),
    ),
    ...extra,
  ];
  const { bytes } = exportFont(setFeatures(fontDocument(glyphs, INFO), features));
  return new Font(new Face(new Blob(bytes)));
}

type Setting = {
  readonly features?: string[];
  readonly script?: string;
  readonly language?: string;
};

/** The glyphs HarfBuzz sets for some text, by name, with their advances. */
function set(font: Font, text: string, setting: Setting = {}) {
  const buffer = new Buffer();
  buffer.addText(text);
  if (setting.script !== undefined) buffer.setScript(setting.script);
  if (setting.language !== undefined) buffer.setLanguage(setting.language);
  buffer.guessSegmentProperties();
  const features = (setting.features ?? []).map((f) => Feature.fromString(f)!);
  shape(font, buffer, features);
  const placed = buffer.getGlyphInfosAndPositions();
  return {
    names: placed.map((p) => font.glyphName(p.codepoint)),
    advances: placed.map((p) => p.xAdvance ?? 0),
  };
}

describe("text set with a compiled feature file", () => {
  it("makes a ligature", () => {
    expect(set(fontWith("feature liga { sub f i by f_i; } liga;"), "fi").names).toEqual(["f_i"]);
  });

  it("replaces one glyph with several", () => {
    const font = fontWith("feature ccmp { sub a by b c; } ccmp;");
    expect(set(font, "a").names).toEqual(["b", "c"]);
  });

  it("offers the alternate a feature value asks for", () => {
    const font = fontWith("feature salt { sub a from [a.alt1 a.alt2]; } salt;");
    expect(set(font, "a").names).toEqual(["a"]);
    expect(set(font, "a", { features: ["salt=1"] }).names).toEqual(["a.alt1"]);
    expect(set(font, "a", { features: ["salt=2"] }).names).toEqual(["a.alt2"]);
  });

  it("applies rules in the order the file writes them", () => {
    // The ligature is written first, so it takes the f before the single rule
    // can turn it into a T.
    expect(set(fontWith("feature liga { sub f i by f_i; sub f by T; } liga;"), "fi").names).toEqual(
      ["f_i"],
    );
    expect(set(fontWith("feature liga { sub f by T; sub f i by f_i; } liga;"), "fi").names).toEqual(
      ["T", "i"],
    );
  });

  it("runs a named lookup where a contextual rule calls it", () => {
    const font = fontWith(`
      lookup SC { sub a by a.sc; sub b by b.sc; } SC;
      feature calt { sub c [a b]' lookup SC; } calt;
    `);
    expect(set(font, "cab").names).toEqual(["c", "a.sc", "b"]);
    expect(set(font, "ab").names).toEqual(["a", "b"]);
  });

  it("looks past a mark when the lookup ignores marks", () => {
    // The accent attaches by its anchor, which is what makes it a mark.
    const marked = [
      glyph("acutecomb", {
        unicodes: [0x301],
        advance: 0,
        contours: [drawn()],
        anchors: [anchor(ids.anchor(), "_top", { x: 0, y: 500 })],
      }),
      glyph("f.top", {
        advance: 500,
        contours: [drawn()],
        anchors: [anchor(ids.anchor(), "top", { x: 250, y: 500 })],
      }),
    ];
    const text = "f́i";
    const skipping = fontWith(
      "feature liga { lookupflag IgnoreMarks; sub f i by f_i; } liga;",
      marked,
    );
    const stopping = fontWith("feature liga { sub f i by f_i; } liga;", marked);
    expect(set(skipping, text).names).toEqual(["f_i", "acutecomb"]);
    expect(set(stopping, text).names).toEqual(["f", "acutecomb", "i"]);
  });

  it("uses a language's own forms for text in that language", () => {
    const font = fontWith(`
      languagesystem DFLT dflt;
      languagesystem latn dflt;
      languagesystem latn TRK;
      feature locl { script latn; language TRK; sub i by i.TRK; } locl;
    `);
    expect(set(font, "i", { script: "Latn", language: "tr" }).names).toEqual(["i.TRK"]);
    expect(set(font, "i", { script: "Latn", language: "en" }).names).toEqual(["i"]);
  });

  it("replaces a glyph by what follows it, reading the line backwards", () => {
    // What `rsub` is for: a form chosen by what comes after it. Here the a
    // becomes a small capital only where a b follows.
    const font = fontWith("feature calt { rsub a' b by a.sc; } calt;");
    expect(set(font, "ab").names).toEqual(["a.sc", "b"]);
    expect(set(font, "ac").names).toEqual(["a", "c"]);
  });

  it("adjusts a glyph only in the context it was written for", () => {
    const font = fontWith("feature kern { pos T o' <0 0 -50 0>; } kern;");
    expect(set(font, "To").advances).toEqual([500, 450]);
    expect(set(font, "oo").advances).toEqual([500, 500]);
  });
});
