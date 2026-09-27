import type { Vec2 } from "@typewright/geometry";
import {
  type Glyph,
  type IdFactory,
  type KnifeCut,
  cutGlyph,
  randomIds,
  resolveGlyphComponents,
  strokeCrossings,
} from "@typewright/font-model";

import { type ToolResult, abort, begin, commit, result } from "./effects.js";
import type { GestureOptions } from "./gestures.js";
import type { PointerInput } from "./input.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "./state.js";

/**
 * The knife: a stroke drawn across the glyph, and the shapes it leaves.
 *
 * A drag like the shape tools, and unlike them in one way that matters — the
 * stroke is not snapped. Snapping exists so a point lands where you meant it,
 * and a cut is not a point: what matters is which side of the outline the stroke
 * passes, and pulling its ends onto whole units or onto the x-height would move
 * the cut somewhere you did not aim.
 */

export type KnifeOptions = GestureOptions & {
  readonly ids?: IdFactory;
};

const fallbackIds = randomIds();

export function pointerDown(state: EditorState, input: PointerInput): ToolResult {
  return result({
    ...state,
    cursor: input.point,
    // Nothing that existed before the cut will exist after it, so a selection
    // pointing into the old contours would be pointing at nothing.
    selection: [],
    knife: { from: input.point, to: input.point },
  });
}

export function pointerMove(state: EditorState, input: PointerInput): ToolResult {
  const knife = state.knife;
  if (knife === null) return result({ ...state, cursor: input.point });
  return result({ ...state, cursor: input.point, knife: { ...knife, to: input.point } });
}

export function pointerUp(
  state: EditorState,
  _input?: PointerInput,
  options: KnifeOptions = {},
): ToolResult {
  const knife = state.knife;
  if (knife === null) return result(state);

  const settled: EditorState = { ...state, knife: null };
  const glyph = currentGlyph(settled);
  if (glyph === null) return result(settled, [abort]);

  const ids = options.ids ?? fallbackIds;
  const through = crossedComponents(settled, glyph, knife.from, knife.to, ids);
  const cut = cutGlyph(through.glyph, knife.from, knife.to, ids);
  // A stroke that crossed nothing is not a cut, and committing one would put a
  // step in the history that changes nothing and undoes nothing. Checked against
  // the glyph with the crossed components already drawn in, so a stroke that
  // crossed a component and then cut nothing leaves the reference as it was.
  if (cut === null || cut.glyph === through.glyph) return result(settled, [abort]);

  const document = editCurrentGlyph(settled, () => cut.glyph);
  if (document === null) return result(settled, [abort]);

  return result({ ...settled, document }, [
    begin(labelFor(cut, through.decomposed), false),
    commit,
  ]);
}

/**
 * The glyph with the components the stroke crosses turned into outlines.
 *
 * A knife drawn across a dollar sign goes through the bars, and a knife that cut
 * the `S` and passed through the bars untouched would be cutting something other
 * than what the stroke visibly crossed. A reference cannot be cut — the outlines
 * belong to the glyph it points at — so the ones the stroke crosses become outlines
 * first, the way the union turns the components it joins into outlines.
 *
 * Only those. A component the stroke does not reach is a reference nobody asked
 * about, and it stays one: the accent above a letter survives a cut through the
 * letter.
 */
function crossedComponents(
  state: EditorState,
  glyph: Glyph,
  from: Vec2,
  to: Vec2,
  ids: IdFactory,
): { readonly glyph: Glyph; readonly decomposed: number } {
  if (glyph.components.length === 0) return { glyph, decomposed: 0 };

  const source = { glyphOf: (name: string) => state.document.glyphs[name] ?? null };
  const drawn: Glyph["contours"][number][] = [];
  const kept: Glyph["components"][number][] = [];
  let decomposed = 0;

  for (const component of glyph.components) {
    const outlines = resolveGlyphComponents(source, glyph.name, [component], ids);
    const alone = { ...glyph, contours: outlines, components: [] };
    // Open contours too: a stroke across an open path divides it, and a
    // component can place one as easily as a closed one.
    if (strokeCrossings(alone, from, to, { open: true }).length > 0) {
      drawn.push(...outlines);
      decomposed += 1;
    } else {
      kept.push(component);
    }
  }

  if (decomposed === 0) return { glyph, decomposed: 0 };
  return {
    glyph: { ...glyph, contours: [...glyph.contours, ...drawn], components: kept },
    decomposed,
  };
}

/**
 * What the stroke did, for the undo menu.
 *
 * The knife divides a shape, joins two into one, or simply puts a point in, and
 * a history of steps all called "Cut" is one nobody can read backwards. Naming
 * the marking case apart is the one that matters: it changed nothing about the
 * shape, so an undo that came back to it would otherwise look like a no-op. A
 * stroke that cuts one stem and only marks another is a cut, and says so.
 */
function labelFor(cut: KnifeCut, decomposed: number): string {
  // A cut through a reference turned it into outlines, which is a thing done to
  // the glyph beyond the cut itself. The undo menu is the one place a stroke has
  // to say so, and it is where somebody looking for what happened to their
  // component will look.
  const marking = cut.marked > 0 && cut.chords === 0 && cut.divided === 0;
  if (decomposed > 0) {
    const what = decomposed === 1 ? "component" : "components";
    return marking ? `Insert point in ${what}` : `Cut through ${what}`;
  }
  if (marking) return cut.marked === 1 ? "Insert point" : "Insert points";
  return "Cut";
}

/** Leaving the canvas abandons the stroke; a half-drawn cut is not a cut. */
export function pointerLeave(state: EditorState): ToolResult {
  if (state.knife === null) return result({ ...state, cursor: null });
  return result({ ...state, cursor: null, knife: null }, [abort]);
}

export function cancel(state: EditorState): ToolResult {
  if (state.knife === null) return result(state);
  return result({ ...state, knife: null }, [abort]);
}

/** The stroke as it stands, for the canvas to draw. */
export function knifeStroke(state: EditorState): readonly [Vec2, Vec2] | null {
  const knife = state.knife;
  if (knife === null) return null;
  return [knife.from, knife.to];
}
