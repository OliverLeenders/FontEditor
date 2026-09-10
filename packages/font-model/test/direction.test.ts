import { vec } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { contourWinding, correctDirections } from "../src/direction.js";
import { contour, reverseContour } from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";

/**
 * Which way round contours run, and putting a set of them right.
 *
 * The rule being kept: a rasteriser fills one path by the non-zero winding rule,
 * so overlapping contours must agree and a counter must disagree with what holds
 * it.
 */

const ids = counterIds("d");

function box(minX: number, minY: number, maxX: number, maxY: number) {
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(minX, minY)),
      node(ids.node(), vec(maxX, minY)),
      node(ids.node(), vec(maxX, maxY)),
      node(ids.node(), vec(minX, maxY)),
    ],
    true,
  );
}

const anticlockwise = (c: ReturnType<typeof box>) => contourWinding(c) > 0;

describe("which way a contour runs", () => {
  it("is positive anticlockwise and negative the other way, y up", () => {
    const square = box(0, 0, 100, 100);
    expect(contourWinding(square)).toBeGreaterThan(0);
    expect(contourWinding(reverseContour(square))).toBeLessThan(0);
  });

  it("is nothing at all for a contour with no area", () => {
    const flat = contour(
      ids.contour(),
      [node(ids.node(), vec(0, 0)), node(ids.node(), vec(100, 0))],
      true,
    );
    expect(contourWinding(flat)).toBe(0);
  });
});

describe("correcting a set of contours", () => {
  it("turns overlapping contours the same way, so their overlap is filled", () => {
    // The bug this exists for: a stem and a shoulder drawn opposite ways round
    // exported with a notch where they cross.
    const stem = box(100, 0, 200, 700);
    const shoulder = reverseContour(box(150, 500, 500, 700));

    const [a, b] = correctDirections([stem, shoulder]);
    expect(anticlockwise(a!)).toBe(true);
    expect(anticlockwise(b!)).toBe(true);
  });

  it("turns a counter against the contour holding it, so it is a hole", () => {
    const outer = box(0, 0, 600, 600);
    const counter = box(200, 200, 400, 400);

    const [o, c] = correctDirections([outer, counter]);
    expect(anticlockwise(o!)).toBe(true);
    expect(anticlockwise(c!)).toBe(false);
  });

  it("fills an island inside a counter", () => {
    // Three deep, as an `8` with something drawn inside one of its bowls.
    const outer = box(0, 0, 900, 900);
    const counter = box(100, 100, 800, 800);
    const island = box(300, 300, 600, 600);

    const fixed = correctDirections([outer, reverseContour(counter), island]);
    expect(fixed.map((c) => anticlockwise(c))).toEqual([true, false, true]);
  });

  it("leaves a set that is already right exactly as it was", () => {
    // The same array back, so a caller can tell by reference whether it acted.
    const already = [box(0, 0, 600, 600), reverseContour(box(200, 200, 400, 400))];
    expect(correctDirections(already)).toBe(already);
  });

  it("leaves open contours and empty sets alone", () => {
    const open = contour(
      ids.contour(),
      [node(ids.node(), vec(0, 0)), node(ids.node(), vec(100, 100))],
      false,
    );
    expect(correctDirections([open])[0]).toBe(open);
    expect(correctDirections([])).toEqual([]);
  });

  it("does not read an overlap as containment", () => {
    // Half of the second box is outside the first, so it is not held by it and
    // must not be turned into a hole.
    const first = box(0, 0, 400, 400);
    const across = box(200, 100, 900, 300);
    expect(correctDirections([first, across]).map((c) => anticlockwise(c))).toEqual([true, true]);
  });
});
