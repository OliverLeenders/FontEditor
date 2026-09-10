import { type Vec2, length, quadraticToCubic, sub } from "@typewright/geometry";
import {
  type Contour,
  type IdFactory,
  type Node,
  type NodeType,
  contour,
  node,
} from "@typewright/font-model";

/**
 * A path as a font file describes it: a flat command list, y up, design units.
 *
 * Our own type, not the parser's, even though the two currently agree. The
 * agreement is what makes the adapter cheap; declaring it ourselves is what
 * means swapping parsers is a new `source.ts` and nothing else.
 */
export type PathCommand =
  | { readonly type: "M"; readonly x: number; readonly y: number }
  | { readonly type: "L"; readonly x: number; readonly y: number }
  | {
      readonly type: "C";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "Q";
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: "Z" };

/**
 * How near to collinear a node's two handles must be to count as smooth.
 *
 * Compared against the sine of the angle between them, so it is a pure ratio and
 * carries no units — 0.01 is a little over half a degree. Font outlines are
 * built on integer grids, so a designer's intended-smooth junction is rarely
 * *exactly* smooth; too tight a tolerance would import a well-made font as a
 * mesh of corner points and make every subsequent drag break the curve.
 */
const SMOOTH_TOLERANCE = 0.01;

/** One span between consecutive on-curve points, handles as the file gave them. */
type Span = { readonly c1: Vec2 | null; readonly c2: Vec2 | null };

type Draft = {
  points: Vec2[];
  spans: Span[];
  closed: boolean;
};

function near(a: Vec2, b: Vec2, epsilon: number): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

/**
 * Decide whether a node's handles were meant to be a smooth junction.
 *
 * A font file does not record the designer's intent — UFO does, TrueType and CFF
 * do not — so it has to be inferred from the geometry. Requiring the handles to
 * point in *opposite* directions from the node (a positive dot product between
 * the incoming and outgoing directions) is what stops a cusp, where the curve
 * doubles back, from being read as smooth merely because it is collinear.
 */
function inferType(pt: Vec2, incoming: Vec2 | null, outgoing: Vec2 | null): NodeType {
  if (incoming === null || outgoing === null) return "corner";

  const before = sub(pt, incoming);
  const after = sub(outgoing, pt);
  const lb = length(before);
  const la = length(after);
  if (lb === 0 || la === 0) return "corner";

  if (before.x * after.x + before.y * after.y <= 0) return "corner";
  const cross = Math.abs(before.x * after.y - before.y * after.x);
  return cross <= SMOOTH_TOLERANCE * lb * la ? "smooth" : "corner";
}

/**
 * Turn one subpath into a contour.
 *
 * The whole job is reconciling two ways of saying the same thing. A file lists
 * spans, each carrying the two handles that shape it; we store nodes, each
 * owning the handle on either side of it. So a node's `out` is the near handle
 * of the span leaving it and its `in` is the far handle of the span arriving —
 * and on a closed contour the first node's `in` comes from the span that wraps.
 */
function finish(draft: Draft, id: IdFactory, epsilon: number): Contour | null {
  let points = draft.points;
  let spans = draft.spans;

  if (points.length === 0) return null;

  if (draft.closed) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (points.length > 1 && near(first, last, epsilon)) {
      // The path drew its way back to where it started. That final point is the
      // same on-curve point as the first, so it is the closing span's endpoint
      // rather than a node of its own — keeping it would leave a zero-length
      // segment that every later operation has to special-case.
      points = points.slice(0, -1);
    } else {
      // Closed without returning: the file means a straight span back to the
      // start, exactly as `closepath` does in PostScript.
      spans = [...spans, { c1: null, c2: null }];
    }
  }

  const count = points.length;
  if (count === 0) return null;

  const nodes: Node[] = points.map((pt, i) => {
    const leaving = spans[i] ?? null;
    const arriving = draft.closed
      ? (spans[(i - 1 + count) % count] ?? null)
      : i === 0
        ? null
        : (spans[i - 1] ?? null);
    const out = leaving?.c1 ?? null;
    const incoming = arriving?.c2 ?? null;
    return node(id.node(), pt, { type: inferType(pt, incoming, out), in: incoming, out });
  });

  return contour(id.contour(), nodes, draft.closed);
}

/**
 * Build contours from a font's path commands.
 *
 * `epsilon` is in design units and decides only whether a closing point
 * coincides with the start. Callers pass a fraction of the em, never an absolute
 * number, because the same font at 1000 and at 2048 units per em must import
 * identically.
 */
export function contoursFromCommands(
  commands: readonly PathCommand[],
  ids: IdFactory,
  epsilon: number,
): Contour[] {
  const contours: Contour[] = [];
  let draft: Draft | null = null;

  const flush = (): void => {
    if (draft === null) return;
    const built = finish(draft, ids, epsilon);
    if (built !== null) contours.push(built);
    draft = null;
  };

  /** The point a span starts from, which a malformed path may not have given. */
  const current = (d: Draft): Vec2 | null => d.points[d.points.length - 1] ?? null;

  for (const command of commands) {
    if (command.type === "M") {
      // An unclosed subpath before a new `moveTo` is a genuinely open contour,
      // which our model supports; it is not an error to recover from.
      flush();
      draft = { points: [{ x: command.x, y: command.y }], spans: [], closed: false };
      continue;
    }

    if (draft === null) continue; // A path that draws before it moves. Skip it.

    if (command.type === "Z") {
      draft.closed = true;
      flush();
      continue;
    }

    const from = current(draft);
    if (from === null) continue;

    if (command.type === "L") {
      draft.spans.push({ c1: null, c2: null });
      draft.points.push({ x: command.x, y: command.y });
      continue;
    }

    if (command.type === "C") {
      draft.spans.push({
        c1: { x: command.x1, y: command.y1 },
        c2: { x: command.x2, y: command.y2 },
      });
      draft.points.push({ x: command.x, y: command.y });
      continue;
    }

    // Raising a quadratic to a cubic is exact, so a TrueType outline arrives
    // with its shape intact. What it does change is node structure, since
    // TrueType's implied on-curve points have to become explicit — but the
    // parser has already made them so by the time the commands reach us.
    const to = { x: command.x, y: command.y };
    const { c1, c2 } = quadraticToCubic({ a: from, q: { x: command.x1, y: command.y1 }, b: to });
    draft.spans.push({ c1, c2 });
    draft.points.push(to);
  }

  flush();
  return contours;
}
