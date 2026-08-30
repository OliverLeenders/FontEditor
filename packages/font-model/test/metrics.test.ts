import { describe, expect, it } from "vitest";

import { contour } from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { glyph } from "../src/glyph.js";
import {
  centreGlyph,
  setLeftSidebearing,
  setRightSidebearing,
  sidebearings,
  translateGlyph,
} from "../src/metrics.js";
import { node } from "../src/node.js";

const ids = counterIds();

/** A box from x=100 to x=400, in a glyph 500 wide: LSB 100, RSB 100. */
const boxGlyph = (advance = 500) =>
  glyph("n", {
    advance,
    contours: [
      contour(
        ids.contour(),
        [
          node(ids.node(), { x: 100, y: 0 }),
          node(ids.node(), { x: 400, y: 0 }),
          node(ids.node(), { x: 400, y: 700 }),
          node(ids.node(), { x: 100, y: 700 }),
        ],
        true,
      ),
    ],
  });

const blank = glyph("space", { advance: 250 });

describe("sidebearings", () => {
  it("measures both sides from the outline and the advance", () => {
    expect(sidebearings(boxGlyph())).toEqual({ left: 100, right: 100 });
    expect(sidebearings(boxGlyph(600))).toEqual({ left: 100, right: 200 });
  });

  it("reports null for a glyph with no outline rather than a meaningless zero", () => {
    expect(sidebearings(blank)).toBeNull();
  });

  it("can be negative when the outline overhangs the origin", () => {
    const overhanging = translateGlyph(boxGlyph(), { x: -150, y: 0 });
    expect(sidebearings(overhanging)).toEqual({ left: -50, right: 250 });
  });
});

describe("setLeftSidebearing", () => {
  it("moves the outline and takes the advance with it, holding the right side", () => {
    const wider = setLeftSidebearing(boxGlyph(), 180);
    expect(sidebearings(wider!)).toEqual({ left: 180, right: 100 });
    expect(wider?.advance).toBe(580);
  });

  it("does not disturb the vertical position", () => {
    const moved = setLeftSidebearing(boxGlyph(), 200);
    const ys = moved!.contours[0]!.nodes.map((n) => n.pt.y);
    expect(ys).toEqual([0, 0, 700, 700]);
  });

  it("carries handles along with their nodes", () => {
    const withHandle = glyph("o", {
      advance: 400,
      contours: [
        contour(
          ids.contour(),
          [
            node(ids.node(), { x: 100, y: 0 }, { out: { x: 160, y: 0 } }),
            node(ids.node(), { x: 300, y: 0 }, { in: { x: 240, y: 0 } }),
          ],
          true,
        ),
      ],
    });
    const moved = setLeftSidebearing(withHandle, 150)!;
    expect(moved.contours[0]?.nodes[0]?.pt.x).toBe(150);
    expect(moved.contours[0]?.nodes[0]?.out?.x).toBe(210);
    expect(moved.contours[0]?.nodes[1]?.in?.x).toBe(290);
  });

  it("accepts a negative sidebearing", () => {
    const overhang = setLeftSidebearing(boxGlyph(), -20)!;
    expect(sidebearings(overhang)).toEqual({ left: -20, right: 100 });
  });

  it("returns the same glyph when nothing changes", () => {
    const g = boxGlyph();
    expect(setLeftSidebearing(g, 100)).toBe(g);
  });

  it("declines on a glyph with no outline", () => {
    expect(setLeftSidebearing(blank, 50)).toBeNull();
  });
});

describe("setRightSidebearing", () => {
  it("changes the advance and leaves the outline where it is", () => {
    const wider = setRightSidebearing(boxGlyph(), 250)!;
    expect(wider.advance).toBe(650);
    expect(sidebearings(wider)).toEqual({ left: 100, right: 250 });
    expect(wider.contours[0]?.nodes[0]?.pt.x).toBe(100);
  });

  it("returns the same glyph when nothing changes", () => {
    const g = boxGlyph();
    expect(setRightSidebearing(g, 100)).toBe(g);
  });

  it("declines on a glyph with no outline", () => {
    expect(setRightSidebearing(blank, 50)).toBeNull();
  });
});

describe("centreGlyph", () => {
  it("splits the spare space evenly without changing the advance", () => {
    const lopsided = setLeftSidebearing(boxGlyph(), 0)!; // advance 400, box 300 wide
    const centred = centreGlyph(lopsided)!;
    const sb = sidebearings(centred)!;

    expect(sb.left).toBeCloseTo(sb.right, 10);
    expect(centred.advance).toBe(lopsided.advance);
  });

  it("declines on a glyph with no outline", () => {
    expect(centreGlyph(blank)).toBeNull();
  });
});
