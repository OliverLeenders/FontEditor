import { IDENTITY_AFFINE, applyAffine, vec } from "@fonteditor/geometry";
import { describe, expect, it } from "vitest";

import { imagePoint, imageRef, invertAffine, placeCrop, shownCrop } from "../src/image.js";

/**
 * The arithmetic behind tracing.
 *
 * All of it is one transform read forwards and backwards: forwards to draw the
 * picture behind the letter, backwards to ask which part of the picture that
 * is. The second is what makes the sheet view free — it is not a second set of
 * data, it is the same numbers inverted — so it had better be right.
 */

const near = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe("placing a picture", () => {
  it("sits at one pixel to the unit when nothing is asked of it", () => {
    const image = imageRef("sheet.png");
    near(imagePoint(image, vec(0, 0)), vec(0, 0));
    near(imagePoint(image, vec(120, 40)), vec(120, 40));
  });

  it("lays a crop of the image onto a rectangle of the glyph", () => {
    // A 100×200 patch of the sheet becomes a letter 500 wide from baseline to
    // 700, which is the whole of what picking a letter off a sheet is.
    const t = placeCrop(
      { from: vec(300, 900), to: vec(400, 1100) },
      { from: vec(0, 0), to: vec(500, 700) },
    );
    expect(t).not.toBeNull();
    if (t === null) return;

    near(applyAffine(t, vec(300, 900)), vec(0, 0));
    near(applyAffine(t, vec(400, 1100)), vec(500, 700));
    // And the middle lands in the middle: no rotation, no shear.
    near(applyAffine(t, vec(350, 1000)), vec(250, 350));
    expect(t.xyScale).toBe(0);
    expect(t.yxScale).toBe(0);
  });

  it("refuses a crop with no area, which no transform can open out", () => {
    const flat = placeCrop(
      { from: vec(10, 10), to: vec(10, 200) },
      { from: vec(0, 0), to: vec(500, 700) },
    );
    expect(flat).toBeNull();
  });
});

describe("reading the placement backwards", () => {
  it("says which part of the picture a glyph is showing", () => {
    const t = placeCrop(
      { from: vec(300, 900), to: vec(400, 1100) },
      { from: vec(0, 0), to: vec(500, 700) },
    );
    if (t === null) throw new Error("no transform");

    const crop = shownCrop(imageRef("sheet.png", t), { from: vec(0, 0), to: vec(500, 700) });
    expect(crop).not.toBeNull();
    if (crop === null) return;

    // Exactly the rectangle it was placed from: the two directions are one
    // number, which is the point of deriving the sheet view rather than storing
    // it.
    near(crop.from, vec(300, 900));
    near(crop.to, vec(400, 1100));
  });

  it("gives a rectangle the right way round however the transform flips", () => {
    // A y scale of -1: the picture is upside down, and the crop is still a
    // rectangle with `from` below `to`.
    const flipped = imageRef("sheet.png", {
      xScale: 1,
      xyScale: 0,
      yxScale: 0,
      yScale: -1,
      xOffset: 0,
      yOffset: 0,
    });
    const crop = shownCrop(flipped, { from: vec(0, 0), to: vec(100, 200) });
    if (crop === null) throw new Error("no crop");

    expect(crop.from.x).toBeLessThan(crop.to.x);
    expect(crop.from.y).toBeLessThan(crop.to.y);
  });

  it("says nothing where the picture has been scaled to nothing", () => {
    const collapsed = imageRef("sheet.png", { ...IDENTITY_AFFINE, xScale: 0 });
    expect(shownCrop(collapsed, { from: vec(0, 0), to: vec(1, 1) })).toBeNull();
  });
});

describe("inverting a transform", () => {
  it("undoes one that scales, moves and shears", () => {
    const t = { xScale: 2, xyScale: 0.3, yxScale: -0.1, yScale: 1.5, xOffset: 40, yOffset: -20 };
    const back = invertAffine(t);
    expect(back).not.toBeNull();
    if (back === null) return;

    for (const p of [vec(0, 0), vec(100, 0), vec(0, 100), vec(-37.5, 812.25)]) {
      near(applyAffine(back, applyAffine(t, p)), p);
      near(applyAffine(t, applyAffine(back, p)), p);
    }
  });

  it("has none for a transform that flattens the plane", () => {
    expect(invertAffine({ ...IDENTITY_AFFINE, xScale: 0, yScale: 0 })).toBeNull();
    // Rows that are multiples of one another: area zero, no way back.
    expect(
      invertAffine({ xScale: 2, xyScale: 4, yxScale: 1, yScale: 2, xOffset: 0, yOffset: 0 }),
    ).toBeNull();
  });
});
