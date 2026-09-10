import { DEFAULT_FONT_INFO, fontDocument, glyph, imageRef } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import {
  currentImage,
  fitImageToGlyph,
  glyphBox,
  moveImageBy,
  moveImageTo,
  placeImageByCrop,
  scaleImageTo,
  shownImageCrop,
} from "../src/commands/images.js";
import { editorState } from "../src/state.js";

/**
 * Where the picture behind a glyph sits.
 *
 * Every command here is the same transform said differently, so the tests are
 * mostly one question: does the corner of the picture land where the numbers
 * say. The last group is the one that matters most — a crop laid on a glyph and
 * then read back has to give the crop again, or the sheet view and the canvas
 * would slowly disagree.
 */

const traced = (advance = 500) =>
  editorState({
    document: fontDocument([glyph("a", { advance, image: imageRef("sheet.png") })], {
      ...DEFAULT_FONT_INFO,
      ascender: 800,
      descender: -200,
    }),
    view: { scale: 1, tx: 0, ty: 0 },
  });

const bare = () =>
  editorState({
    document: fontDocument([glyph("a", { advance: 500 })], DEFAULT_FONT_INFO),
    view: { scale: 1, tx: 0, ty: 0 },
  });

describe("moving the picture", () => {
  it("nudges it, keeping its size", () => {
    const out = moveImageBy(traced(), 20, -8).state;
    const t = currentImage(out)?.transform;

    expect(t?.xOffset).toBe(20);
    expect(t?.yOffset).toBe(-8);
    expect(t?.xScale).toBe(1);
  });

  it("puts its corner exactly where a field says", () => {
    const out = moveImageTo(traced(), { x: -40, y: 120 }).state;
    expect(currentImage(out)?.transform.xOffset).toBe(-40);
    expect(currentImage(out)?.transform.yOffset).toBe(120);
  });

  it("does nothing where the glyph has no picture", () => {
    const before = bare();
    expect(moveImageBy(before, 10, 10).state).toBe(before);
  });
});

describe("scaling it", () => {
  it("scales both ways together by default", () => {
    const t = currentImage(scaleImageTo(traced(), 0.4).state)?.transform;
    expect(t?.xScale).toBe(0.4);
    expect(t?.yScale).toBe(0.4);
  });

  it("takes them apart when asked, for a photograph that needs correcting", () => {
    const t = currentImage(scaleImageTo(traced(), 0.4, 0.5).state)?.transform;
    expect(t?.xScale).toBe(0.4);
    expect(t?.yScale).toBe(0.5);
  });

  it("refuses a scale that would flatten it", () => {
    const before = traced();
    expect(scaleImageTo(before, 0).state).toBe(before);
    expect(scaleImageTo(before, Number.NaN).state).toBe(before);
  });
});

describe("laying it across the glyph", () => {
  it("fills the height from descender to ascender, keeping its proportions", () => {
    // 500 by 1000 pixels into a font 1000 units tall: a scale of one.
    const out = fitImageToGlyph(traced(), { width: 500, height: 1000 }).state;
    const t = currentImage(out)?.transform;

    expect(t?.yScale).toBe(1);
    expect(t?.xScale).toBe(t?.yScale);
    expect(t?.yOffset).toBe(-200);
    // Centred across the advance, which is 500 wide against a picture 500 wide.
    expect(t?.xOffset).toBe(0);
  });

  it("centres a picture wider than the letter", () => {
    const out = fitImageToGlyph(traced(300), { width: 1000, height: 1000 }).state;
    const t = currentImage(out)?.transform;

    // A thousand pixels at a scale of one is 1000 units across a 300 advance.
    expect(t?.xOffset).toBe((300 - 1000) / 2);
  });

  it("refuses a picture with no size", () => {
    const before = traced();
    expect(fitImageToGlyph(before, { width: 0, height: 100 }).state).toBe(before);
  });
});

describe("picking a letter off a sheet", () => {
  it("lands the crop on the glyph's box", () => {
    const state = traced();
    const onto = glyphBox(state);
    const crop = { from: { x: 300, y: 900 }, to: { x: 400, y: 1100 } };

    const out = placeImageByCrop(state, crop, onto).state;
    const t = currentImage(out)?.transform;
    if (t === undefined) throw new Error("no placement");

    // The crop's corners land on the box's corners.
    expect(300 * t.xScale + t.xOffset).toBeCloseTo(onto.from.x, 9);
    expect(900 * t.yScale + t.yOffset).toBeCloseTo(onto.from.y, 9);
    expect(400 * t.xScale + t.xOffset).toBeCloseTo(onto.to.x, 9);
    expect(1100 * t.yScale + t.yOffset).toBeCloseTo(onto.to.y, 9);
  });

  it("reads back the very rectangle it was given", () => {
    // The whole reason the sheet view stores nothing: the box it draws is the
    // placement inverted, so a round trip has to be exact.
    const state = traced();
    const onto = glyphBox(state);
    const crop = { from: { x: 300, y: 900 }, to: { x: 400, y: 1100 } };

    const out = placeImageByCrop(state, crop, onto).state;
    const back = shownImageCrop(out, onto);
    if (back === null) throw new Error("no crop");

    expect(back.from.x).toBeCloseTo(300, 9);
    expect(back.from.y).toBeCloseTo(900, 9);
    expect(back.to.x).toBeCloseTo(400, 9);
    expect(back.to.y).toBeCloseTo(1100, 9);
  });

  it("refuses a box with no area", () => {
    const state = traced();
    const flat = { from: { x: 10, y: 10 }, to: { x: 10, y: 200 } };
    expect(placeImageByCrop(state, flat, glyphBox(state)).state).toBe(state);
  });

  it("has no crop to show where there is no picture", () => {
    const state = bare();
    expect(shownImageCrop(state, glyphBox(state))).toBeNull();
  });
});
