import type { Cubic, PenShape } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { STROKE_CASES } from "../../geometry/test/stroke-cases.js";
import type { Contour } from "../src/contour.js";
import { contourOfCurves } from "../src/curves.js";
import { counterIds } from "../src/ids.js";
import type { StrokeEnd } from "../src/node.js";
import { plannedInk } from "../src/stroke.js";

/**
 * How many strokes a variable font still draws as its default master does.
 *
 * A stroke varies in a variable font where its ink can be drawn to one plan in
 * every master — see `plannedStrokes` — and where it cannot, every weight has
 * the default master's ink and the export says so. Which strokes those are was
 * known only case by case, as each was found. This counts them: every path the
 * stroke tests draw, with an oval pen, a softened one, a rectangle and a broad
 * edge, turning from nought to ninety degrees from one point to the next, with
 * each kind of end, in two masters — that differ in the pen's size, in how
 * much it turns along the stroke, or in what kind of pen it is.
 *
 * Each count is held to what it was when it was last brought down. A count
 * that rises is a stroke that varied and does not now; one that falls is to be
 * written in here, so that it stays down. Minutes of planning, and so asked for
 * with `STROKE_DIAGNOSE`, as the other sweeps are, and run every night.
 */

const ids = counterIds("census");
const KINDS = ["oval", "soft", "box", "broad"] as const;
type Kind = (typeof KINDS)[number];
const TURNS = [0, 12, 35, 60, 90];
const ENDS = ["none", "square", "nib"] as const;
const SIZES = [
  [50, 24],
  [110, 46],
  [70, 60],
  [36, 20],
  [90, 30],
] as const;

/**
 * At most this many of the 940 fall back, as each kind of difference between
 * the two masters. Counted on 2026-10-14:
 *
 * - **size**: a broad edge turning sixty degrees or more from one point to
 *   the next. 27, until a pen still pivoting where an open path begins or
 *   ends was taken along its edge to a corner there.
 * - **turn**: a broad edge whose masters turn by different amounts. 111,
 *   until a master's runs were matched to another's wherever the run it has
 *   not got falls; then 90, until a pivot over an instant was drawn as a line
 *   across and runs no master holds all of were put in one order; then 48,
 *   until the pivoting open ends above; then 9, until the pen was made to change
 *   smoothly along each curve rather than in a kink at every chord.
 * - **kind**: a broad edge beside an oval round a tight bend — a hairpin, a
 *   bend tighter than the pen, a path crossing itself — where no oval thin
 *   enough to stand in for the broad edge can be fitted. 940, every one
 *   declined, until a broad edge beside a rounder pen was drawn as the
 *   thinnest pen of the other kind the plan could be made with.
 */
const MOST: Record<"size" | "turn" | "kind", number> = { size: 6, turn: 6, kind: 24 };

const penOf = (kind: Kind, i: number, turn: number, wide: number): PenShape => {
  const angle = 10 + i * turn;
  const [width, thickness] = SIZES[i % SIZES.length]!;
  if (kind === "broad") return { angle, width: width * wide, thickness: 0 };
  return {
    angle,
    width: width * wide,
    thickness: thickness * wide,
    squareness: kind === "oval" ? 0 : kind === "soft" ? 0.5 : 1,
  };
};

const strokeOf = (
  curves: readonly Cubic[],
  closed: boolean,
  pens: readonly PenShape[],
  end: StrokeEnd | undefined,
): Contour => {
  const skeleton = contourOfCurves(
    curves.map((curve) => ({ curve, line: false })),
    ids,
    closed,
  );
  const last = skeleton.nodes.length - 1;
  return {
    ...skeleton,
    nib: pens[0]!,
    nodes: skeleton.nodes.map((n, i) => ({
      ...n,
      pen: pens[i % pens.length]!,
      ...(end !== undefined && !closed && (i === 0 || i === last) ? { end } : {}),
    })),
  };
};

/** The two masters' pens differ in how much: their size, how much they turn, or their kind. */
function census(differ: "size" | "turn" | "kind"): { fell: string[]; all: number } {
  const other = (kind: Kind): Kind =>
    differ !== "kind" ? kind : kind === "broad" ? "oval" : "broad";
  const fell: string[] = [];
  let all = 0;
  for (const c of STROKE_CASES) {
    // A step in a blend is a change of pen at a point, declined on its own.
    if (c.blends?.some((b) => b?.angle === "step" || b?.shape === "step") === true) continue;
    const n = c.closed ? c.curves.length : c.curves.length + 1;
    for (const kind of KINDS) {
      for (const turn of TURNS) {
        for (const ends of ENDS) {
          if (c.closed && ends !== "none") continue;
          const end: StrokeEnd | undefined =
            ends === "none"
              ? undefined
              : ends === "square"
                ? { cut: "square" }
                : { cut: "square", shape: "nib" };
          const masters = [0, 1].map((at) =>
            strokeOf(
              c.curves,
              c.closed,
              Array.from({ length: n }, (_, i) =>
                penOf(
                  at === 0 ? kind : other(kind),
                  i,
                  at === 1 && differ === "turn" ? turn + 20 : turn,
                  at === 0 ? 1 : 1.6,
                ),
              ),
              end,
            ),
          );
          all += 1;
          let planned: unknown;
          try {
            planned = plannedInk(masters, ids);
          } catch {
            planned = null;
          }
          if (planned === null) fell.push(`${kind}, turning ${String(turn)}, ${ends}: ${c.name}`);
        }
      }
    }
  }
  return { fell, all };
}

describe.skipIf(process.env["STROKE_DIAGNOSE"] === undefined)(
  "how many strokes are drawn as the default master in a variable font",
  () => {
    it.each(["size", "turn", "kind"] as const)(
      "is no more than it was, the masters' pens differing in %s",
      { timeout: 3_600_000 },
      (differ) => {
        const { fell, all } = census(differ);
        process.stdout.write(
          `\nDiffering in ${differ}: ${String(fell.length)} of ${String(all)} drawn as the default master\n`,
        );
        expect(all).toBe(940);
        expect(fell.length, fell.join("\n")).toBeLessThanOrEqual(MOST[differ]);
      },
    );
  },
);
