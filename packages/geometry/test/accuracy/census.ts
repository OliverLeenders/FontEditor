import { type StrokeMaster, plannedStrokes } from "../../src/convolution.js";
import type { PenShape } from "../../src/pen.js";
import { STROKE_CASES } from "../stroke-cases.js";
import { disagreement, sweep } from "../sweep.js";

/**
 * Whether what is planned for a variable font is the ink, stroke by stroke.
 *
 * The census in font-model counts the strokes that are not planned at all. This
 * asks the others whether each master's line round the ink fills as that
 * master's pen swept along the path does: every path the stroke tests draw,
 * with an oval pen, a softened one, a rectangle and a broad edge, turning from
 * nought to ninety degrees a point, in two masters that differ in the pen's
 * size or in its kind.
 *
 * Some do not, and that is known: where a pen much bigger than a bend changes
 * fast, the line falls short of the ink on the outside of it, and where its
 * side folds back on the inside, the line goes round some ink the wrong way
 * and leaves it out. See docs/roadmap-1.0.md. How many masters leave any ink
 * out is held to what it was, so that it only goes down.
 *
 * An hour and more in one process, so split into shards that run side by side,
 * each held to its own count; asked for with `STROKE_ACCURACY`, every night.
 */

const KINDS = ["oval", "soft", "box", "broad"] as const;
type Kind = (typeof KINDS)[number];
const TURNS = [0, 12, 35, 60, 90];
const SIZES = [
  [50, 24],
  [110, 46],
  [70, 60],
  [36, 20],
  [90, 30],
] as const;

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

type Config = {
  readonly differ: "size" | "kind";
  readonly c: number;
  readonly kind: Kind;
  readonly turn: number;
};

const CONFIGS: Config[] = (["size", "kind"] as const).flatMap((differ) =>
  STROKE_CASES.flatMap((_, c) =>
    KINDS.flatMap((kind) => TURNS.map((turn) => ({ differ, c, kind, turn }))),
  ),
);

/** How many shards the census is split into. */
export const SHARDS = 12;

/**
 * Of each shard, at most this many masters' lines leave ink out. Counted on
 * 2026-10-17, once strips were laid along the sides where the pen changes:
 * 127 of the 1,340 masters planned, where it was 141.
 */
export const MOST: readonly number[] = [14, 14, 9, 10, 9, 10, 6, 13, 14, 15, 7, 6];

/** The masters of one shard whose line leaves ink out, by what they are. */
export function shortOfInk(shard: number): string[] {
  const short: string[] = [];
  CONFIGS.forEach((cfg, i) => {
    if (i % SHARDS !== shard) return;
    const c = STROKE_CASES[cfg.c]!;
    const n = c.closed ? c.curves.length : c.curves.length + 1;
    const other: Kind = cfg.differ === "size" ? cfg.kind : cfg.kind === "broad" ? "oval" : "broad";
    const masters: StrokeMaster[] = [0, 1].map((at) => ({
      curves: c.curves,
      pens: Array.from({ length: n }, (_, k) =>
        penOf(at === 0 ? cfg.kind : other, k, cfg.turn, at === 0 ? 1 : 1.6),
      ),
      closed: c.closed,
    }));
    const planned = plannedStrokes(masters);
    if (planned === null) return;
    for (const [at, m] of masters.entries()) {
      const d = disagreement(
        planned[at]!.map((loop) => loop.map((piece) => piece.curve)),
        sweep(m.curves, m.pens, m.closed),
        50,
      );
      if (d.missing.length + d.extra.length > 0) {
        short.push(
          `${cfg.differ}, ${c.name}, ${cfg.kind}, turning ${String(cfg.turn)}, master ${String(at)}: ` +
            `${String(d.missing.length)} left out, ${String(d.extra.length)} too much`,
        );
      }
    }
  });
  return short;
}
