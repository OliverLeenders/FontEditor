import {
  type Component,
  type Contour,
  type ContourId,
  type Glyph,
  type GlyphName,
  type IdFactory,
  contoursMeet,
  inLayer,
  putGlyph,
  removeOverlap,
  resolveGlyphComponents,
  withLayer,
  randomIds,
} from "@typewright/font-model";
import { type ToolResult, result } from "../effects.js";
import { type EditorState } from "../state.js";
import { done } from "./shared.js";

/**
 * Removing the overlap between the contours of one glyph, or between a few of
 * them.
 */

/** Ids for the nodes and contours a union produces, when a caller names none. */
const overlapIds = randomIds();

/**
 * What removing overlap from a glyph would do, without doing it.
 *
 * Three answers, because there are three things worth saying afterwards: what
 * was resolved, "nothing was overlapping", and "this could not be resolved". The
 * last is the one that matters — two edges lying exactly along each other have
 * no crossing points to split at, and a tool that quietly reshaped the letter
 * there would be worse than one that declines.
 *
 * The first answer carries two numbers. How many places were resolved, and how
 * many components had to become outlines to do it — because that is a thing done
 * to the glyph beyond joining its edges, and a tool that did it without saying so
 * would be taking a decision on somebody's behalf.
 */
export type OverlapOutcome = "clean" | "refused" | OverlapDone;

export type OverlapDone = {
  /** Crossings and buried shared edges, as the union counts them. */
  readonly places: number;
  /** How many components were turned into outlines so they could take part. */
  readonly decomposed: number;
};

/**
 * The contours the selection claims, or `null` for the whole glyph.
 *
 * A contour is claimed by *any* of its points being selected, rather than by
 * all of them — the same rule copying uses, and for the same reason: a partial
 * contour is not a thing either operation has an answer for. Overlap is a fact
 * about a contour rather than about its points, so touching it is claiming it,
 * and a marquee that missed one node still means the shape it drew a box round.
 */
export function selectedContourIds(state: EditorState): ReadonlySet<ContourId> | null {
  if (state.selection.length === 0) return null;
  return new Set(state.selection.map((item) => item.contourId));
}

export function overlapAt(
  state: EditorState,
  name: GlyphName,
  only: ReadonlySet<ContourId> | null = null,
  ids: IdFactory = overlapIds,
): { readonly outcome: OverlapOutcome; readonly result: ToolResult } {
  const whole = state.document.glyphs[name];
  if (whole === undefined) return { outcome: "clean", result: result(state) };
  // The open glyph in the layer being drawn; any other glyph as the font draws it.
  const layer = name === state.currentGlyph ? state.layer : null;
  const g = inLayer(whole, layer);

  // What the union is asked about, with any component that takes part turned
  // into the outlines it stands for. A reference cannot be joined to a contour:
  // the union works on outlines, and the dollar sign — an S with two bars across
  // it — is contours and components overlapping each other.
  const taking = takingPart(g, state, only, ids);
  const asked: Glyph = {
    ...g,
    contours: [...g.contours, ...taking.contours],
    components: taking.left,
  };
  // The decomposed outlines join whatever the caller named. Nothing else does:
  // asking about two selected contours does not ask about the rest of the glyph.
  const scope = only === null ? null : new Set([...only, ...taking.contours.map((c) => c.id)]);

  const union = removeOverlap(asked, ids, scope);
  if (union === null) return { outcome: "refused", result: result(state) };
  // Nothing was resolved, so nothing is done — the components that were about to
  // be decomposed stay references. Two shapes that touch without either being
  // buried in the other are a drawing that is already its own union.
  if (union.crossings === 0) return { outcome: "clean", result: result(state) };

  // The selection named nodes that the union has replaced with new ones, so
  // there is nothing left for it to point at. Clearing it is the honest answer:
  // a selection of ids that no longer exist draws nothing and moves nothing,
  // and undo puts the old one back with the old contours.
  const after = {
    ...state,
    document: putGlyph(state.document, withLayer(whole, layer, union.glyph)),
    selection: [],
  };

  return {
    outcome: { places: union.crossings, decomposed: taking.decomposed },
    result: done(state, after, only === null ? "Remove overlap" : "Remove overlap in selection"),
  };
}

/**
 * Which of a glyph's components have to become outlines, and what they draw.
 *
 * Nothing, when the caller named the contours to work on. A selection says which
 * shapes to join, a component is not one of the shapes it can name, and a
 * component that merely happens to lie across them is a shape somebody did not
 * ask about — joining two contours with a bar drawn behind them took the bar with
 * them, which is the opposite of what selecting two things means. What `only`
 * promises is that everything outside it is left exactly as it was drawn, and a
 * reference turned into outlines is not that.
 *
 * For the glyph as a whole it is the other way round: nothing was named, so
 * everything is in, and a component takes part when its outlines meet a contour
 * or another component. An accent sitting clear above a letter meets nothing and
 * stays a reference — that is the whole value of a composite, and a union that
 * flattened every `ä` in the font on its way past would be a worse tool than one
 * that does nothing.
 *
 * Resolved one component at a time, because each carries its own transform and
 * the answer is per component. The owner's name seeds the cycle guard, which is
 * what keeps a glyph that refers to itself from drawing itself twice.
 */
function takingPart(
  g: Glyph,
  state: EditorState,
  only: ReadonlySet<ContourId> | null,
  ids: IdFactory,
): {
  readonly contours: readonly Contour[];
  readonly left: readonly Component[];
  readonly decomposed: number;
} {
  if (only !== null) return { contours: [], left: g.components, decomposed: 0 };
  if (g.components.length === 0) return { contours: [], left: g.components, decomposed: 0 };

  const source = { glyphOf: (name: string) => state.document.glyphs[name] ?? null };
  const parts = g.components.map((component) => ({
    component,
    drawn: resolveGlyphComponents(source, g.name, [component], ids),
  }));

  const meets = (drawn: readonly Contour[], others: readonly Contour[]): boolean =>
    drawn.some((one) => others.some((other) => contoursMeet(one, other)));

  const involved = parts.filter(
    (part) =>
      meets(part.drawn, g.contours) ||
      parts.some((other) => other !== part && meets(part.drawn, other.drawn)),
  );

  return {
    contours: involved.flatMap((part) => part.drawn),
    left: g.components.filter((c) => !involved.some((part) => part.component === c)),
    decomposed: involved.length,
  };
}

/** Remove overlap from one glyph, for callers with nothing to say about it. */
export function removeOverlapAt(
  state: EditorState,
  name: GlyphName,
  ids: IdFactory = overlapIds,
): ToolResult {
  return overlapAt(state, name, null, ids).result;
}
