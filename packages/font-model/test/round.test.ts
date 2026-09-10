import { IDENTITY_AFFINE } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { addContour, glyph } from "../src/glyph.js";
import { component } from "../src/component.js";
import { contour } from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { DEFAULT_FONT_INFO, fontDocument } from "../src/document.js";
import { node } from "../src/node.js";
import { roundFont, roundGlyph, unroundedGlyphs } from "../src/round.js";

const ids = counterIds();

const fractional = () =>
  contour(
    ids.contour(),
    [
      node(
        ids.node(),
        { x: 100.4, y: 200.6 },
        {
          type: "smooth",
          in: { x: 50.2, y: 200.6 },
          out: { x: 150.7, y: 200.6 },
        },
      ),
      node(ids.node(), { x: 300.5, y: 400.5 }),
    ],
    false,
  );

const whole = () =>
  contour(
    ids.contour(),
    [node(ids.node(), { x: 100, y: 200 }), node(ids.node(), { x: 300, y: 0 })],
    false,
  );

describe("roundGlyph", () => {
  it("puts anchors and handles on whole units", () => {
    const g = roundGlyph(addContour(glyph("a", { advance: 500 }), fractional()));
    const [first, second] = g.contours[0]!.nodes;

    expect(first!.pt).toEqual({ x: 100, y: 201 });
    expect(first!.in).toEqual({ x: 50, y: 201 });
    expect(first!.out).toEqual({ x: 151, y: 201 });
    expect(second!.pt).toEqual({ x: 301, y: 401 });
  });

  it("rounds the advance", () => {
    expect(roundGlyph(glyph("a", { advance: 499.6 })).advance).toBe(500);
  });

  it("leaves a node with no handles alone", () => {
    const g = roundGlyph(addContour(glyph("a"), fractional()));
    expect(g.contours[0]!.nodes[1]!.in).toBeNull();
  });

  it("keeps a smooth node smooth in name", () => {
    // The type is intent — it is what makes the next handle drag swing the other
    // side — so rounding must not quietly demote hundreds of nodes to corners.
    const g = roundGlyph(addContour(glyph("a"), fractional()));
    expect(g.contours[0]!.nodes[0]!.type).toBe("smooth");
  });

  it("returns the very same glyph when nothing moves", () => {
    // Reference equality is how the store decides what to save. Rounding an
    // already-round font must not mark every glyph in it as changed.
    const g = addContour(glyph("a", { advance: 500 }), whole());
    expect(roundGlyph(g)).toBe(g);
  });

  it("moves a component's placement but not its scale", () => {
    const placed = glyph("aacute", {
      advance: 500,
      components: [
        component(ids.component(), "a", {
          ...IDENTITY_AFFINE,
          xScale: 0.92,
          xOffset: 12.4,
          yOffset: -3.6,
        }),
      ],
    });
    const t = roundGlyph(placed).components[0]!.transform;

    expect(t.xOffset).toBe(12);
    expect(t.yOffset).toBe(-4);
    // A component at 92% rounded to 100% would not be a correction, it would be
    // a different glyph.
    expect(t.xScale).toBe(0.92);
  });

  it("honours a grid coarser than one unit", () => {
    const g = roundGlyph(addContour(glyph("a"), fractional()), 10);
    expect(g.contours[0]!.nodes[0]!.pt).toEqual({ x: 100, y: 200 });
  });
});

describe("roundFont", () => {
  const font = () =>
    fontDocument([
      addContour(glyph("a", { advance: 500.4 }), fractional()),
      addContour(glyph("b", { advance: 500 }), whole()),
    ]);

  it("rounds every glyph that needs it", () => {
    const d = roundFont(font());
    expect(d.glyphs["a"]!.advance).toBe(500);
    expect(d.glyphs["a"]!.contours[0]!.nodes[0]!.pt).toEqual({ x: 100, y: 201 });
  });

  it("leaves an already-round glyph as the very same object", () => {
    const before = font();
    const after = roundFont(before);
    expect(after.glyphs["b"]).toBe(before.glyphs["b"]);
  });

  it("returns the very same document when there is nothing to do", () => {
    const d = roundFont(font());
    expect(roundFont(d)).toBe(d);
  });

  it("leaves the font's own metrics alone", () => {
    // An x-height of 512.4 is a decision about the design, not an accident of
    // arithmetic, and "round coordinates" is a question about the drawing.
    const d = fontDocument([glyph("a")], {
      ...DEFAULT_FONT_INFO,
      ascender: 750.5,
      xHeight: 512.4,
    });
    expect(roundFont(d).info.xHeight).toBe(512.4);
    expect(roundFont(d).info.ascender).toBe(750.5);
  });
});

describe("unroundedGlyphs", () => {
  it("counts only the glyphs that would change", () => {
    const d = fontDocument([addContour(glyph("a"), fractional()), addContour(glyph("b"), whole())]);
    expect(unroundedGlyphs(d)).toBe(1);
  });

  it("is zero once the font is rounded", () => {
    const d = roundFont(fontDocument([addContour(glyph("a"), fractional())]));
    expect(unroundedGlyphs(d)).toBe(0);
  });
});
