import { describe, expect, it } from "vitest";

import {
  type Contour,
  type Nib,
  contour,
  contourBounds,
  nibOfShape,
  penShapeOf,
} from "../src/contour.js";
import { insideGlyph } from "../src/direction.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { interpolateGlyph } from "../src/interpolate.js";
import { node } from "../src/node.js";
import { blendNib, inkOf, plannedInk, samePen, withNib } from "../src/stroke.js";

/**
 * A pen with corners, as a stroke keeps it and draws with it.
 *
 * The shape is the geometry's and is held against a swept pen there. Here: that
 * a stroke's ink has the corners its pen has, that the number is kept as the
 * pen's other numbers are — and not written at all for the oval and the broad
 * edge every stroke had before there was one.
 */

const ids = counterIds("sq");
const at = (x: number, y: number) => ({ x, y });

/** A level pen, eighty by forty, down a stem from 600 to the baseline. */
const stem = (nib: Nib): Contour =>
  withNib(
    contour(ids.contour(), [node(ids.node(), at(200, 600)), node(ids.node(), at(200, 0))], false),
    nib,
  );
const inked = (contours: readonly Contour[], x: number, y: number): boolean =>
  insideGlyph(glyph("g", { contours: [...contours] }), at(x, y));

describe("a stroke drawn with a pen that has corners", () => {
  const oval: Nib = { angle: 0, width: 80, thickness: 40 };

  it("ends square where the oval's end is round", () => {
    // Just inside the corner of the box the pen stands in at the foot.
    const corner = [200 + 37, -17] as const;
    expect(inked(inkOf(stem(oval), ids), ...corner)).toBe(false);
    expect(inked(inkOf(stem({ ...oval, squareness: 1 }), ids), ...corner)).toBe(true);
  });

  it("is no wider and no longer for it", () => {
    const box = (nib: Nib) => contourBounds(inkOf(stem(nib), ids)[0]!)!;
    const round = box(oval);
    const square = box({ ...oval, squareness: 1 });
    expect(square.minX).toBeCloseTo(round.minX, 1);
    expect(square.maxX).toBeCloseTo(round.maxX, 1);
    expect(square.minY).toBeCloseTo(round.minY, 1);
    expect(square.maxY).toBeCloseTo(round.maxY, 1);
  });

  it("is one outline however square, its ends joined to it", () => {
    // The flatter a pen's side, the less it takes to move the furthest point
    // along it; the sine of half a turn, which is not quite nothing, put the end
    // of a square pen's cap eleven units from the stem it was meant to meet, and
    // the stroke came to three outlines.
    for (const squareness of [0.25, 0.9, 1]) {
      expect(inkOf(stem({ ...oval, squareness }), ids)).toHaveLength(1);
    }
  });

  it("is one outline, and a rounded box between the two", () => {
    const half = inkOf(stem({ ...oval, squareness: 0.5 }), ids);
    expect(half).toHaveLength(1);
    // Past the oval at the corner, and short of the corner itself.
    expect(inked(half, 200 + 32, -14)).toBe(true);
    expect(inked(half, 200 + 38.5, -18.5)).toBe(false);
  });

  it("is not yet drawn to one plan for a variable font", () => {
    const squared = stem({ ...oval, squareness: 0.5 });
    expect(plannedInk([squared, squared], ids)).toBeNull();
    expect(plannedInk([stem(oval), stem(oval)], ids)).not.toBeNull();
  });
});

describe("a pen's squareness, kept", () => {
  it("is part of what makes two pens the same", () => {
    const pen: Nib = { angle: 30, width: 80, thickness: 20 };
    expect(samePen(pen, { ...pen, squareness: 0 })).toBe(true);
    expect(samePen(pen, { ...pen, squareness: 0.4 })).toBe(false);
  });

  it("is not said of an oval or of a broad edge", () => {
    expect(nibOfShape(penShapeOf({ angle: 30, width: 80, thickness: 20 }))).toEqual({
      angle: 30,
      width: 80,
      thickness: 20,
    });
    expect(nibOfShape({ angle: 30, width: 80, thickness: 0, squareness: 0.7 })).toEqual({
      angle: 30,
      width: 80,
    });
    expect(nibOfShape({ angle: 30, width: 80, thickness: 20, squareness: 0.7 })).toEqual({
      angle: 30,
      width: 80,
      thickness: 20,
      squareness: 0.7,
    });
  });

  it("blends between two points' pens", () => {
    const round: Nib = { angle: 0, width: 80, thickness: 40 };
    expect(blendNib(round, { ...round, squareness: 1 }, 0.25).squareness).toBeCloseTo(0.25, 9);
    expect("squareness" in blendNib(round, round, 0.5)).toBe(false);
  });

  it("interpolates between masters, an oval counting as none", () => {
    const light = glyph("i", { contours: [stem({ angle: 0, width: 40, thickness: 20 })] });
    const bold = glyph("i", {
      contours: [stem({ angle: 0, width: 120, thickness: 60, squareness: 1 })],
    });
    const between = interpolateGlyph([bold, light], [0.5, 0.5])!;
    expect(between.contours[0]!.nib).toEqual({
      angle: 0,
      width: 80,
      thickness: 40,
      squareness: 0.5,
    });
  });
});
