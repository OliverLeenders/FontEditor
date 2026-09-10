import { IDENTITY_AFFINE, translation } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import {
  type ComponentSource,
  MAX_COMPONENT_DEPTH,
  attachmentOffset,
  component,
  movedComponent,
  resolveComponent,
  wouldRecurse,
} from "../src/component.js";
import { anchor } from "../src/anchor.js";
import { contour } from "../src/contour.js";
import {
  type Glyph,
  addAnchor,
  addGlyphComponent,
  decomposedGlyph,
  glyph,
  isComposite,
} from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";

const ids = () => counterIds("r");

/** A unit square at the origin, so a transform's effect is obvious. */
const square = (id: string) =>
  contour(
    id,
    [
      node(`${id}1`, { x: 0, y: 0 }),
      node(`${id}2`, { x: 100, y: 0 }, { in: { x: 60, y: 0 } }),
      node(`${id}3`, { x: 100, y: 100 }),
    ],
    true,
  );

function library(glyphs: Record<string, Glyph>): ComponentSource {
  return { glyphOf: (name) => glyphs[name] ?? null };
}

describe("resolveComponent", () => {
  const base = library({
    a: glyph("a", { advance: 500, contours: [square("s")] }),
    empty: glyph("empty", { advance: 250 }),
  });

  it("returns the base glyph's contours, transformed", () => {
    const out = resolveComponent(base, "a", translation(10, 20), ids());
    expect(out).toHaveLength(1);
    expect(out[0]?.nodes.map((n) => n.pt)).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 120 },
    ]);
  });

  it("transforms handles along with their nodes", () => {
    const out = resolveComponent(base, "a", translation(10, 20), ids());
    expect(out[0]?.nodes[1]?.in).toEqual({ x: 70, y: 20 });
  });

  it("keeps point types and closedness", () => {
    const out = resolveComponent(base, "a", IDENTITY_AFFINE, ids());
    expect(out[0]?.closed).toBe(true);
    expect(out[0]?.nodes[0]?.type).toBe("corner");
  });

  it("gives the resolved contours fresh ids, since they are not the glyph's", () => {
    const out = resolveComponent(base, "a", IDENTITY_AFFINE, ids());
    expect(out[0]?.id).not.toBe("s");
    expect(out[0]?.nodes[0]?.id).not.toBe("s1");
  });

  it("returns nothing for a glyph that is not there", () => {
    expect(resolveComponent(base, "missing", IDENTITY_AFFINE, ids())).toEqual([]);
  });

  it("returns nothing for a glyph that draws nothing", () => {
    expect(resolveComponent(base, "empty", IDENTITY_AFFINE, ids())).toEqual([]);
  });

  it("follows nesting, composing the transforms", () => {
    const nested = library({
      a: glyph("a", { contours: [square("s")] }),
      b: glyph("b", { components: [component("k1", "a", translation(10, 0))] }),
      c: glyph("c", { components: [component("k2", "b", translation(0, 5))] }),
    });

    // c places b at +5y, and b places a at +10x, so a lands at (10, 5).
    const out = resolveComponent(nested, "c", IDENTITY_AFFINE, ids());
    expect(out).toHaveLength(1);
    expect(out[0]?.nodes[0]?.pt).toEqual({ x: 10, y: 5 });
  });

  it("draws a glyph's own contours as well as its components", () => {
    const mixed = library({
      a: glyph("a", { contours: [square("s")] }),
      b: glyph("b", {
        contours: [square("own")],
        components: [component("k1", "a", translation(500, 0))],
      }),
    });
    const out = resolveComponent(mixed, "b", IDENTITY_AFFINE, ids());
    expect(out).toHaveLength(2);
    expect(out[0]?.nodes[0]?.pt).toEqual({ x: 0, y: 0 });
    expect(out[1]?.nodes[0]?.pt).toEqual({ x: 500, y: 0 });
  });

  it("refuses to follow a glyph that refers to itself", () => {
    const loop = library({
      a: glyph("a", { contours: [square("s")], components: [component("k1", "a")] }),
    });
    // The glyph's own contour still draws; only the loop is cut.
    const out = resolveComponent(loop, "a", IDENTITY_AFFINE, ids());
    expect(out).toHaveLength(1);
  });

  it("refuses to follow a longer loop", () => {
    const loop = library({
      a: glyph("a", { components: [component("k1", "b")] }),
      b: glyph("b", { components: [component("k2", "c")] }),
      c: glyph("c", { contours: [square("s")], components: [component("k3", "a")] }),
    });
    const out = resolveComponent(loop, "a", IDENTITY_AFFINE, ids());
    expect(out).toHaveLength(1);
  });

  it("stops following a chain that is merely absurdly deep", () => {
    const glyphs: Record<string, Glyph> = {
      end: glyph("end", { contours: [square("s")] }),
    };
    let previous = "end";
    for (let i = 0; i < MAX_COMPONENT_DEPTH + 4; i++) {
      const name = `g${String(i)}`;
      glyphs[name] = glyph(name, { components: [component(`k${String(i)}`, previous)] });
      previous = name;
    }

    // No cycle here, so only the depth guard can stop it.
    const out = resolveComponent(library(glyphs), previous, IDENTITY_AFFINE, ids());
    expect(out).toEqual([]);
  });
});

describe("wouldRecurse", () => {
  const source = library({
    a: glyph("a", { contours: [square("s")] }),
    b: glyph("b", { components: [component("k1", "a")] }),
    c: glyph("c", { components: [component("k2", "b")] }),
  });

  it("catches a glyph placed inside itself", () => {
    expect(wouldRecurse(source, "a", "a")).toBe(true);
  });

  it("catches a loop that would close through other glyphs", () => {
    // Putting c inside a would make a → c → b → a.
    expect(wouldRecurse(source, "a", "c")).toBe(true);
    expect(wouldRecurse(source, "a", "b")).toBe(true);
  });

  it("allows a placement that closes no loop", () => {
    expect(wouldRecurse(source, "c", "a")).toBe(false);
    expect(wouldRecurse(source, "new", "a")).toBe(false);
  });

  it("does not hang on a font that already contains a loop", () => {
    const broken = library({
      x: glyph("x", { components: [component("k1", "y")] }),
      y: glyph("y", { components: [component("k2", "x")] }),
    });
    expect(wouldRecurse(broken, "z", "x")).toBe(false);
  });
});

describe("movedComponent", () => {
  it("adds to the offset without disturbing the rest of the transform", () => {
    const skewed = component("k1", "a", {
      ...IDENTITY_AFFINE,
      xScale: 2,
      xyScale: 0.5,
      xOffset: 10,
      yOffset: 20,
    });
    const moved = movedComponent(skewed, 5, -5);
    expect(moved.transform.xOffset).toBe(15);
    expect(moved.transform.yOffset).toBe(15);
    expect(moved.transform.xScale).toBe(2);
    expect(moved.transform.xyScale).toBe(0.5);
  });
});

describe("isComposite", () => {
  it("is true only for a glyph that draws nothing of its own", () => {
    expect(isComposite(glyph("a", { components: [component("k1", "b")] }))).toBe(true);
    expect(
      isComposite(glyph("a", { contours: [square("s")], components: [component("k1", "b")] })),
    ).toBe(false);
    expect(isComposite(glyph("a", { contours: [square("s")] }))).toBe(false);
    expect(isComposite(glyph("a"))).toBe(false);
  });
});

describe("attachment by anchors", () => {
  const letter = () =>
    addAnchor(glyph("a", { advance: 500 }), anchor("k1", "top", { x: 250, y: 700 }));
  const accent = () =>
    addAnchor(glyph("acute", { advance: 0 }), anchor("k2", "_top", { x: 40, y: 690 }));

  it("solves the offset that makes the pair coincide", () => {
    const at = attachmentOffset(letter(), accent(), IDENTITY_AFFINE)!;
    expect(at).toEqual({ x: 210, y: 10 });

    // Which is to say: placed there, the accent's own anchor lands on the
    // letter's.
    const placed = { x: 40 + at.x, y: 690 + at.y };
    expect(placed).toEqual({ x: 250, y: 700 });
  });

  it("solves it under a transform that is already scaling the accent", () => {
    const half = { ...IDENTITY_AFFINE, xScale: 0.5, yScale: 0.5 };
    const at = attachmentOffset(letter(), accent(), half)!;
    // The mark anchor is carried by the scale first: 40 and 690 halve.
    expect(at).toEqual({ x: 230, y: 355 });
  });

  it("has no answer where the two share no pair", () => {
    const bare = glyph("acute", { advance: 0 });
    expect(attachmentOffset(letter(), bare, IDENTITY_AFFINE)).toBeNull();

    // A base anchor on the accent is not a mark anchor: only `_top` attaches.
    const wrong = addAnchor(glyph("acute"), anchor("k3", "top", { x: 40, y: 690 }));
    expect(attachmentOffset(letter(), wrong, IDENTITY_AFFINE)).toBeNull();

    // And a letter without the anchor the accent names.
    expect(attachmentOffset(glyph("b"), accent(), IDENTITY_AFFINE)).toBeNull();
  });
});

describe("decomposing", () => {
  it("draws the components in as contours and gives up the references", () => {
    const composed = addGlyphComponent(
      glyph("aacute", { advance: 500 }),
      component("k1", "acute", { ...IDENTITY_AFFINE, xOffset: 10 }),
    );
    const out = decomposedGlyph(composed, () => [
      contour("c9", [node("n9", { x: 0, y: 0 }), node("n10", { x: 10, y: 10 })], false),
    ]);

    expect(out.components).toHaveLength(0);
    expect(out.contours).toHaveLength(1);
    expect(out.contours[0]!.nodes).toHaveLength(2);
  });

  it("leaves a glyph with nothing to decompose exactly as it was", () => {
    const plain = glyph("a", { advance: 500 });
    expect(decomposedGlyph(plain, () => [])).toBe(plain);
  });
});
