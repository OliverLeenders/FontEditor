import { IDENTITY_AFFINE, translation } from "@fonteditor/geometry";
import { describe, expect, it } from "vitest";

import {
  type ComponentSource,
  MAX_COMPONENT_DEPTH,
  component,
  movedComponent,
  resolveComponent,
  wouldRecurse,
} from "../src/component.js";
import { contour } from "../src/contour.js";
import { type Glyph, glyph, isComposite } from "../src/glyph.js";
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
