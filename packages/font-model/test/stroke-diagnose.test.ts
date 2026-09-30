import type { Cubic } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { STROKE_CASES } from "../../geometry/test/stroke-cases.js";
import { disagreement, sweep } from "../../geometry/test/sweep.js";
import { segmentAt, segmentCount, segmentCubic } from "../src/contour.js";
import { contourOfCurves } from "../src/curves.js";
import { counterIds } from "../src/ids.js";
import { inkOf } from "../src/stroke.js";

/**
 * A diagnostic, not a gate: how many outlines each stroke converts into, how many
 * points they have and how close together, and whether they fill as the pen does.
 */
describe.skipIf(process.env["STROKE_DIAGNOSE"] === undefined)("converting strokes", () => {
  it.each(STROKE_CASES)("$name", { timeout: 300_000 }, (c) => {
    const ids = counterIds("case-");
    const skeleton = contourOfCurves(
      c.curves.map((curve) => ({ curve, line: false })),
      ids,
      c.closed,
    );
    const pens = c.pens.map((p) => ({ angle: p.angle, width: p.width, thickness: p.thickness }));
    const stroked = {
      ...skeleton,
      nib: pens[0]!,
      nodes: skeleton.nodes.map((n, i) => ({
        ...n,
        ...(pens[i] === undefined ? {} : { pen: pens[i] }),
        ...(c.blends?.[i] === undefined ? {} : { blend: c.blends[i] }),
      })),
    };
    const ink = inkOf(stroked, ids);
    const nodes = ink.reduce((sum, o) => sum + o.nodes.length, 0);
    let closest = Infinity;
    for (const o of ink) {
      for (let i = 0; i < o.nodes.length; i++) {
        const a = o.nodes[i]!.pt;
        const b = o.nodes[(i + 1) % o.nodes.length]!.pt;
        closest = Math.min(closest, Math.hypot(b.x - a.x, b.y - a.y));
      }
    }
    const loops: Cubic[][] = ink.map((o) => {
      const out: Cubic[] = [];
      for (let i = 0; i < segmentCount(o); i++) {
        const s = segmentAt(o, i);
        if (s !== null) out.push(segmentCubic(s));
      }
      return out;
    });
    const d = disagreement(loops, sweep(c.curves, c.pens, c.closed, c.blends));
    console.log(
      `${c.name}: ${String(ink.length)} outline(s), ${String(nodes)} points, closest ${closest.toFixed(2)}, ${String(d.missing.length)} missing, ${String(d.extra.length)} extra`,
    );
    expect(ink.length).toBeGreaterThanOrEqual(0);
  });
});
