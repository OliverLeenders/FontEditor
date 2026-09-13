import { describe, expect, it } from "vitest";

import { anchor } from "../src/anchor.js";
import {
  type GlyphLookup,
  attachComponents,
  buildComposite,
  compositeParts,
  compositePlan,
} from "../src/composites.js";
import { component } from "../src/component.js";
import { contour } from "../src/contour.js";
import { type FontDocument, fontDocument, putGlyph } from "../src/document.js";
import { type Glyph, glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";

/**
 * Accented letters built from their parts.
 *
 * The fixture is a handful of letters and marks with anchors at numbers chosen
 * so every offset can be checked by subtraction: a letter's `top` minus the
 * accent's `_top` is exactly where the accent must go.
 */

const ids = counterIds("t");

/** A small closed triangle, so a glyph counts as drawn. */
const mark = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: 10, y: 0 }),
      node(ids.node(), { x: 5, y: 10 }),
    ],
    true,
  );

const letter = (name: string, code: number, anchors: readonly [string, number, number][]): Glyph =>
  glyph(name, {
    unicodes: [code],
    advance: 500,
    contours: [mark()],
    anchors: anchors.map(([n, x, y]) => anchor(ids.anchor(), n, { x, y })),
  });

function font(...extra: Glyph[]): FontDocument {
  return fontDocument([
    letter("e", 0x65, [["top", 250, 520]]),
    letter("i", 0x69, [["top", 120, 700]]),
    letter("dotlessi", 0x131, [["top", 120, 520]]),
    letter("u", 0x75, [["top", 250, 520]]),
    letter("acutecomb", 0x301, [["_top", 100, 480]]),
    letter("dieresiscomb", 0x308, [
      ["_top", 100, 480],
      ["top", 100, 700],
    ]),
    ...extra,
  ]);
}

const lookup =
  (document: FontDocument): GlyphLookup =>
  (name) =>
    document.glyphs[name] ?? null;

describe("which glyphs a character is built from", () => {
  it("reads the parts off Unicode's decomposition and the font's own characters", () => {
    expect(compositeParts(font(), 0xe9)).toEqual(["e", "acutecomb"]);
  });

  it("has no recipe for a character that does not decompose", () => {
    expect(compositeParts(font(), 0x65)).toBeNull();
  });

  it("has no recipe when the font lacks a part", () => {
    // è needs a grave, and this font has none.
    expect(compositeParts(font(), 0xe8)).toBeNull();
  });

  it("will not build from a part that is not drawn yet", () => {
    const empty = putGlyph(font(), glyph("acutecomb", { unicodes: [0x301] }));
    expect(compositeParts(empty, 0xe9)).toBeNull();
  });

  it("puts an accent on a dotless i, or the letter gets a dot and an accent", () => {
    expect(compositeParts(font(), 0xed)).toEqual(["dotlessi", "acutecomb"]);
  });

  it("keeps the dotted i when the font has no dotless one", () => {
    const withoutDotless = fontDocument(
      Object.values(font().glyphs).filter((g) => g.name !== "dotlessi"),
    );
    expect(compositeParts(withoutDotless, 0xed)).toEqual(["i", "acutecomb"]);
  });
});

describe("placing components on their anchors", () => {
  it("lands the accent's _top on the letter's top", () => {
    const document = font();
    const owner = glyph("eacute", {
      components: [component("c1", "e"), component("c2", "acutecomb")],
    });

    const { components, unplaced } = attachComponents(owner, lookup(document));

    expect(unplaced).toEqual([]);
    expect(components[0]!.transform.xOffset).toBe(0);
    // top (250, 520) minus _top (100, 480).
    expect(components[1]!.transform.xOffset).toBe(150);
    expect(components[1]!.transform.yOffset).toBe(40);
  });

  it("stacks a second mark on the first mark's own top", () => {
    const document = font();
    const owner = glyph("udieresisacute", {
      components: [
        component("c1", "u"),
        component("c2", "dieresiscomb"),
        component("c3", "acutecomb"),
      ],
    });

    const { components } = attachComponents(owner, lookup(document));

    // The dieresis lands on u's top: (150, 40).
    expect(components[1]!.transform.yOffset).toBe(40);
    // Its own top is then at (100 + 150, 700 + 40) = (250, 740), and the acute's
    // _top (100, 480) lands there.
    expect(components[2]!.transform.xOffset).toBe(150);
    expect(components[2]!.transform.yOffset).toBe(260);
  });

  it("reports an accent with nothing to land on, and leaves it where it is", () => {
    const bare = putGlyph(
      font(),
      glyph("e", { unicodes: [0x65], advance: 500, contours: [mark()] }),
    );
    const owner = glyph("eacute", {
      components: [component("c1", "e"), component("c2", "acutecomb")],
    });

    const { components, unplaced } = attachComponents(owner, lookup(bare));

    expect(unplaced).toEqual(["acutecomb"]);
    expect(components).toBe(owner.components);
  });

  it("returns the same components when nothing moved, so a sweep can tell", () => {
    const document = font();
    const placed = attachComponents(
      glyph("eacute", { components: [component("c1", "e"), component("c2", "acutecomb")] }),
      lookup(document),
    ).components;
    const settled = glyph("eacute", { components: placed });

    expect(attachComponents(settled, lookup(document)).components).toBe(settled.components);
  });
});

describe("planning and building composites", () => {
  it("offers what can be built and placed", () => {
    const { buildable, problems } = compositePlan(font(), [0xe9, 0xed, 0xe8]);

    expect(buildable.map((b) => b.codePoint)).toEqual([0xe9, 0xed]);
    expect(problems).toEqual([]);
  });

  it("never offers to replace a glyph that is already drawn", () => {
    const drawn = font(letter("eacute", 0xe9, []));
    expect(compositePlan(drawn, [0xe9]).buildable).toEqual([]);
  });

  it("builds into an empty glyph for the character, keeping its name", () => {
    const empty = font(glyph("eacute", { unicodes: [0xe9] }));
    const [build] = compositePlan(empty, [0xe9]).buildable;

    expect(build).toMatchObject({ into: "eacute", name: "eacute" });
  });

  it("names the ones held back for want of an anchor", () => {
    const bare = putGlyph(
      font(),
      glyph("e", { unicodes: [0x65], advance: 500, contours: [mark()] }),
    );
    const { buildable, problems } = compositePlan(bare, [0xe9]);

    expect(buildable).toEqual([]);
    expect(problems).toEqual([{ codePoint: 0xe9, name: "uni00E9", unplaced: ["acutecomb"] }]);
  });

  it("builds a composite placed by its anchors and spaced from its letter", () => {
    const document = font();
    const [build] = compositePlan(document, [0xe9]).buildable;
    const built = buildComposite(document, build!, counterIds("b")).glyphs["uni00E9"]!;

    expect(built.unicodes).toEqual([0xe9]);
    expect(built.contours).toEqual([]);
    expect(built.components.map((c) => c.base)).toEqual(["e", "acutecomb"]);
    expect(built.components[1]!.transform.xOffset).toBe(150);
    expect(built.advance).toBe(500);
    // A key rather than a copied number, so the e's spacing reaches it.
    expect(built.metricKeys.width).toBe("e");
  });
});
