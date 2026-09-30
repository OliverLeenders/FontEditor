import { describe, expect, it } from "vitest";

import type { Cubic } from "../src/cubic.js";
import { loopArea, reverseLoop } from "../src/nib.js";
import { penPathStroke } from "../src/pen.js";
import { STROKE_CASES, type StrokeCase } from "./stroke-cases.js";
import { disagreement, sweep } from "./sweep.js";

/**
 * The ink a stroke's pieces fill, held against the pen swept along the path the
 * slow way (see `sweep.ts`): no hole where the pen went, no ink where it did not.
 *
 * The strokes that have gone wrong in use, on a coarse grid so the check stays
 * quick, and a fine one over the place each went wrong. `STROKE_DIAGNOSE` runs
 * every case, in `stroke-diagnose`.
 */

const named = (name: string): StrokeCase => STROKE_CASES.find((c) => c.name === name)!;

const filled = (c: StrokeCase): Cubic[][] =>
  penPathStroke(c.curves, c.pens, c.closed, undefined, c.blends).map((loop) =>
    loopArea(loop) < 0 ? reverseLoop(loop) : loop,
  );

describe("a stroke's ink, against the pen swept along it", () => {
  it.each(
    [
      "a drawn hook with retracted handles",
      "a drawn J with a sharp corner",
      "an oval pen round a sharp V",
      "a round pen round a hairpin",
    ].map(named),
  )("fills as the pen does: $name", { timeout: 120_000 }, (c) => {
    const d = disagreement(filled(c), sweep(c.curves, c.pens, c.closed, c.blends), 45);
    expect(d.checked).toBeGreaterThan(500);
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
  });

  it(
    "leaves no notch on the inside of a bend whose handle is pulled onto its point",
    {
      timeout: 120_000,
    },
    () => {
      // Where the drawn hook had one: the samples of a fold dropped and the gap
      // crossed straight, through ink, where the side should have been cut where
      // it crosses itself.
      const c = named("a drawn hook with retracted handles");
      const d = disagreement(filled(c), sweep(c.curves, c.pens, c.closed, c.blends), 40, 0.4, {
        minX: 296,
        minY: 154,
        maxX: 320,
        maxY: 180,
      });
      expect(d.checked).toBeGreaterThan(200);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual([]);
    },
  );

  it(
    "leaves no gap just past a sharp corner where the next curve bends tighter than the pen",
    {
      timeout: 120_000,
    },
    () => {
      // Where the drawn J had one: the curve leaving the corner folds on its inside
      // from its first point, its side running out and back past itself without
      // crossing, so there was nothing to cut the fold at.
      const c = named("a drawn J with a sharp corner");
      const d = disagreement(filled(c), sweep(c.curves, c.pens, c.closed, c.blends), 40, 0.4, {
        minX: 358,
        minY: 212,
        maxX: 388,
        maxY: 234,
      });
      expect(d.checked).toBeGreaterThan(200);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual([]);
    },
  );
});
