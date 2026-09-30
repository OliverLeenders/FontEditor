import { describe, expect, it } from "vitest";

import { loopArea, reverseLoop } from "../src/nib.js";
import { penPathStroke } from "../src/pen.js";
import { STROKE_CASES } from "./stroke-cases.js";
import { disagreement, sweep } from "./sweep.js";

/** A diagnostic, not a gate: how the pieces the stroker makes today fill, case by case. */
describe.skipIf(process.env["STROKE_DIAGNOSE"] === undefined)("the stroker today", () => {
  it.each(STROKE_CASES)("$name", { timeout: 120_000 }, (c) => {
    const loops = penPathStroke(c.curves, c.pens, c.closed, undefined, c.blends).map((loop) =>
      loopArea(loop) < 0 ? reverseLoop(loop) : loop,
    );
    const d = disagreement(loops, sweep(c.curves, c.pens, c.closed, c.blends));
    console.log(
      `${c.name}: ${String(d.checked)} checked, ${String(d.missing.length)} missing, ${String(d.extra.length)} extra`,
      d.missing.slice(0, 3),
      d.extra.slice(0, 3),
    );
    expect(d.checked).toBeGreaterThan(0);
  });
});
