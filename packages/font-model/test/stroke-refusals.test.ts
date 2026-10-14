import type { Cubic, PenShape } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { STROKE_CASES } from "../../geometry/test/stroke-cases.js";
import { glyphIncompatibilities } from "../src/compatible.js";
import type { Contour } from "../src/contour.js";
import { contourOfCurves } from "../src/curves.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { knownPenProblem, plannedInk, whyNotOnePlan } from "../src/stroke.js";

/**
 * A stroke a variable font cannot vary, said as what about its pen to change.
 *
 * Such a stroke is written as the default master draws it at every weight,
 * and the export said only that: "drawn with a pen do not vary". Which pen,
 * and what to do about it, was nowhere — and the check between two masters,
 * which is where a drawing is put right, said nothing at all.
 */

const ids = counterIds("refusals");

const strokeOf = (curves: readonly Cubic[], pens: readonly PenShape[]): Contour => {
  const skeleton = contourOfCurves(
    curves.map((curve) => ({ curve, line: false })),
    ids,
    false,
  );
  return {
    ...skeleton,
    nib: pens[0]!,
    nodes: skeleton.nodes.map((n, i) => ({ ...n, pen: pens[i % pens.length]! })),
  };
};

const named = (name: string) => STROKE_CASES.find((c) => c.name === name)!;
const broad = (angle: number, width = 80): PenShape => ({ angle, width, thickness: 0 });
const oval = (angle: number, width = 80): PenShape => ({ angle, width, thickness: 30 });

describe("a stroke whose pen keeps it from varying", () => {
  const s = named("an oval pen along an S").curves;

  it("is a broad edge in one master and a rounder pen in another", () => {
    const light = strokeOf(s, [broad(30), broad(40)]);
    const bold = strokeOf(s, [oval(30, 120), oval(40, 120)]);
    expect(plannedInk([light, bold], ids)).toBeNull();
    expect(whyNotOnePlan([light, bold])).toMatch(/broad edge in one place and a rounder pen/);
  });

  it("is a pen held and then changed at a point", () => {
    const held = strokeOf(s, [oval(30), oval(70)]);
    const stepped = {
      ...held,
      nodes: held.nodes.map((n, i) =>
        i === 0 ? { ...n, blend: { angle: "step" as const, shape: "linear" as const } } : n,
      ),
    };
    expect(whyNotOnePlan([stepped, stepped])).toMatch(/held and then changed at a point/);
  });

  it("is a broad edge turned too far between two points, and says how far and what to do", () => {
    const c = named("a pen widening along a line");
    const light = strokeOf(c.curves, [broad(10, 50), broad(100, 110)]);
    const bold = strokeOf(c.curves, [broad(10, 80), broad(100, 176)]);
    expect(plannedInk([light, bold], ids)).toBeNull();
    expect(whyNotOnePlan([light, bold])).toBe(
      "its broad edge turns 90° between two of its points, further than its ends can be followed round; put a point between them",
    );
  });

  it("is a broad edge turning by different amounts in different masters, where it cannot be followed", () => {
    const c = named("a drawn hook with retracted handles");
    const n = c.curves.length + 1;
    const light = strokeOf(
      c.curves,
      Array.from({ length: n }, (_, i) => broad(10 + i * 35, 50)),
    );
    const bold = strokeOf(
      c.curves,
      Array.from({ length: n }, (_, i) => broad(10 + i * 55, 80)),
    );
    expect(plannedInk([light, bold], ids)).toBeNull();
    expect(whyNotOnePlan([light, bold])).toMatch(
      /^its broad edge turns along the stroke by different amounts in different masters/,
    );
  });

  it("is said plainly where it is none of those", () => {
    // Masters whose paths have not the same number of curves: not the pen.
    const one = strokeOf(s, [oval(30), oval(40)]);
    const two = strokeOf([...s, ...s], [oval(30), oval(40), oval(50)]);
    expect(knownPenProblem([one, two])).toBeNull();
    expect(whyNotOnePlan([one, two])).toBe(
      "its ink does not come to the same points in every master",
    );
  });

  it("is nothing to say of a pen that varies", () => {
    const light = strokeOf(s, [oval(30), oval(40)]);
    const bold = strokeOf(s, [oval(30, 120), oval(40, 120)]);
    expect(plannedInk([light, bold], ids)).not.toBeNull();
    expect(knownPenProblem([light, bold])).toBeNull();
  });
});

describe("the check between two masters", () => {
  it("names a stroke whose pen keeps it from varying, and what to change", () => {
    const s = named("an oval pen along an S").curves;
    const light = glyph("s", { contours: [strokeOf(s, [broad(30), broad(40)])] });
    const bold = glyph("s", { contours: [strokeOf(s, [oval(30, 120), oval(40, 120)])] });

    const found = glyphIncompatibilities("s", light, bold);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "pen", contour: 0 });
    expect(found[0]?.says).toMatch(/^Contour 1 will not vary: its pen is a broad edge/);
  });

  it("says nothing of a stroke that varies", () => {
    const s = named("an oval pen along an S").curves;
    const light = glyph("s", { contours: [strokeOf(s, [oval(30), oval(40)])] });
    const bold = glyph("s", { contours: [strokeOf(s, [oval(30, 120), oval(40, 120)])] });
    expect(glyphIncompatibilities("s", light, bold)).toEqual([]);
  });
});
