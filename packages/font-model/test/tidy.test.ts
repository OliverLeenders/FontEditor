import { describe, expect, it } from "vitest";

import {
  type Contour,
  DEFAULT_FONT_INFO,
  contour,
  correctDirections,
  counterIds,
  fillAsWound,
  fontDocument,
  glyph,
  node,
  sameInk,
  tidyContour,
  tidyFont,
  tidyGlyph,
  untidyGlyphs,
  withNib,
} from "../src/index.js";

/**
 * A font read from a font file before reading one got better, brought up to
 * what it would be read as now — without reading it again, which would lose
 * what has been drawn in it since.
 */

const ids = counterIds("tidy");
const at = (
  x: number,
  y: number,
  handles: { in?: [number, number]; out?: [number, number] } = {},
) =>
  node(
    ids.node(),
    { x, y },
    {
      ...(handles.in === undefined ? {} : { in: { x: handles.in[0], y: handles.in[1] } }),
      ...(handles.out === undefined ? {} : { out: { x: handles.out[0], y: handles.out[1] } }),
    },
  );

const square = (left: number, bottom: number, size: number, anticlockwise = true): Contour => {
  const corners: [number, number][] = [
    [left, bottom],
    [left + size, bottom],
    [left + size, bottom + size],
    [left, bottom + size],
  ];
  return contour(
    ids.contour(),
    (anticlockwise ? corners : [...corners].reverse()).map(([x, y]) => at(x, y)),
    true,
  );
};

/** A corner rounded by a curve, as a TrueType outline read in once had it: the point after the curve twice. */
const doubled = (): Contour =>
  contour(
    ids.contour(),
    [
      at(0, 0),
      at(100, 0, { out: [150, 0] }),
      at(200, 50, { in: [200, 20] }),
      at(200, 50),
      at(200, 200),
      at(0, 200),
    ],
    true,
  );

describe("an outline tidied", () => {
  it("loses the point that sits on the point before it, and no shape", () => {
    const c = doubled();
    const tidied = tidyContour(c);

    expect(tidied.nodes).toHaveLength(5);
    expect(sameInk([c], [tidied])).toBe(true);
    // The curve still arrives where it did, by the handle it had.
    const corner = tidied.nodes.find((n) => n.pt.x === 200 && n.pt.y === 50)!;
    expect(corner.in).toEqual({ x: 200, y: 20 });
    expect(corner.out).toBeNull();
  });

  it("loses a handle that sits on its own point", () => {
    const c = contour(
      ids.contour(),
      [at(0, 0, { out: [0, 0] }), at(100, 0, { in: [60, 40], out: [100, 0] }), at(50, 100)],
      true,
    );
    const tidied = tidyContour(c);

    expect(tidied.nodes[0]?.out).toBeNull();
    expect(tidied.nodes[1]?.in).toEqual({ x: 60, y: 40 });
    expect(tidied.nodes[1]?.out).toBeNull();
    expect(tidied.nodes[1]?.type).toBe("corner");
    expect(sameInk([c], [tidied])).toBe(true);
  });

  it("is the same contour where there was nothing to tidy", () => {
    const c = square(0, 0, 100);
    expect(tidyContour(c)).toBe(c);
    const g = glyph("a", { contours: [c] });
    expect(tidyGlyph(g)).toBe(g);
  });

  it("leaves a stroke's path alone, where two points at one place may be meant", () => {
    const path = withNib(doubled(), { angle: 30, width: 80, thickness: 20 });
    expect(tidyContour(path)).toBe(path);
  });

  it("is counted, and done, for every glyph of a font at once", () => {
    const font = fontDocument(
      [
        glyph("a", { advance: 500, contours: [doubled()] }),
        glyph("b", { advance: 500, contours: [square(0, 0, 100)] }),
        glyph("c", { advance: 500, contours: [doubled(), square(300, 0, 50)] }),
      ],
      DEFAULT_FONT_INFO,
    );
    expect(untidyGlyphs(font)).toBe(2);

    const tidied = tidyFont(font);
    expect(untidyGlyphs(tidied)).toBe(0);
    expect(tidied.glyphs["b"]).toBe(font.glyphs["b"]);
    expect(tidied.glyphs["a"]?.contours[0]?.nodes).toHaveLength(5);
    // And done again, it is the font it was given.
    expect(tidyFont(tidied)).toBe(tidied);
  });
});

describe("a font filled as its file filled it", () => {
  /** As this editor fills a drawing: turned by its nesting. */
  const filled = (contours: readonly Contour[]): readonly Contour[] => correctDirections(contours);

  const font = () =>
    fontDocument(
      [
        // A frame and its counter, as a font draws them.
        glyph("frame", {
          advance: 500,
          contours: [square(0, 0, 400), square(100, 100, 200, false)],
        }),
        // Ink inside ink, which nesting takes for a counter.
        glyph("buried", { advance: 500, contours: [square(0, 0, 400), square(100, 100, 200)] }),
        glyph("one", { advance: 500, contours: [square(0, 0, 100)] }),
      ],
      DEFAULT_FONT_INFO,
    );

  it("says which glyphs it would redraw, and redraws only those", () => {
    const before = font();
    const plan = fillAsWound(before, ids);

    expect(plan.redrawn).toEqual(["buried"]);
    expect(plan.left).toEqual([]);
    expect(plan.document.glyphs["frame"]).toBe(before.glyphs["frame"]);
    expect(plan.document.glyphs["one"]).toBe(before.glyphs["one"]);

    const was = before.glyphs["buried"]!.contours;
    const is = plan.document.glyphs["buried"]!.contours;
    expect(sameInk(was, filled(was))).toBe(false);
    expect(sameInk(was, filled(is), 2)).toBe(true);
  });

  it("has nothing to do the second time", () => {
    const once = fillAsWound(font(), ids).document;
    const again = fillAsWound(once, ids);
    expect(again.redrawn).toEqual([]);
    expect(again.document).toBe(once);
  });
});
