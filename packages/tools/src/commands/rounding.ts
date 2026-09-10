import type { Vec2 } from "@typewright/geometry";
import {
  type ContourId,
  type GlyphName,
  type Node,
  putGlyph,
  roundFont,
  updateContour,
  roundGlyph,
  unroundedGlyphs,
} from "@typewright/font-model";
import { itemPoint } from "@typewright/view";
import { type ToolResult, result } from "../effects.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "../state.js";
import { done } from "./shared.js";

/**
 * Putting coordinates on whole units: a selection of them, one glyph, or the
 * whole font.
 */

/**
 * Put every coordinate in the font on whole units.
 *
 * The whole font rather than the open glyph, because the problem it answers is
 * a font-wide one: an import from a different em size, or a drawing made before
 * anything rounded. Doing it a glyph at a time would leave a font in two states
 * and no way to tell which glyphs had been done.
 *
 * One undo step for all of it, which is the only sane arrangement — a partial
 * undo of this would be worse than not undoing it.
 */
export function roundCoordinates(state: EditorState): ToolResult {
  const document = roundFont(state.document);
  if (document === state.document) return result(state);
  return done(state, { ...state, document }, "Round coordinates");
}

/** How many glyphs {@link roundCoordinates} would change, for a caller to say so. */
export function unroundedCount(state: EditorState): number {
  return unroundedGlyphs(state.document);
}

/**
 * Put one glyph's coordinates on whole units.
 *
 * The same operation as the font-wide one, aimed. Worth having separately
 * because a font-wide round is a decision about the whole file and this is a
 * decision about the glyph in front of you — and because undoing the wrong one
 * takes back a great deal more than was meant.
 */
export function roundGlyphAt(state: EditorState, name: GlyphName): ToolResult {
  const glyph = state.document.glyphs[name];
  if (glyph === undefined) return result(state);

  const rounded = roundGlyph(glyph);
  if (rounded === glyph) return result(state);

  return done(state, { ...state, document: putGlyph(state.document, rounded) }, "Round glyph");
}

/**
 * Put the selected points and handles on whole units, and nothing else.
 *
 * Literally what is selected: a selected on-curve point rounds its own
 * coordinate and a selected handle rounds its own. A point does *not* drag its
 * handles onto the grid with it — they are positions in their own right, they
 * can be selected in their own right, and rounding things nobody picked is how a
 * command like this stops being predictable.
 */
export function roundSelection(state: EditorState): ToolResult {
  if (state.selection.length === 0) return result(state);

  const wanted = new Map<ContourId, Set<string>>();
  for (const item of state.selection) {
    const parts = wanted.get(item.contourId) ?? new Set<string>();
    parts.add(`${item.nodeId} ${item.part}`);
    wanted.set(item.contourId, parts);
  }

  let editor = state;
  for (const [contourId, parts] of wanted) {
    const document = editCurrentGlyph(editor, (g) =>
      updateContour(g, contourId, (c) => ({
        ...c,
        nodes: c.nodes.map((n) => roundParts(n, parts)),
      })),
    );
    if (document !== null) editor = { ...editor, document };
  }

  return done(state, editor === state ? null : editor, "Round selection");
}

const whole = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** A node with just the selected parts of it rounded, or the node unchanged. */
function roundParts(n: Node, parts: ReadonlySet<string>): Node {
  const pt = parts.has(`${n.id} point`) ? whole(n.pt) : n.pt;
  const incoming = n.in !== null && parts.has(`${n.id} in`) ? whole(n.in) : n.in;
  const outgoing = n.out !== null && parts.has(`${n.id} out`) ? whole(n.out) : n.out;

  const same = pt.x === n.pt.x && pt.y === n.pt.y && incoming === n.in && outgoing === n.out;

  return same ? n : { ...n, pt, in: incoming, out: outgoing };
}

/** How many selected coordinates {@link roundSelection} would move. */
export function unroundedSelected(state: EditorState): number {
  const glyph = currentGlyph(state);
  if (glyph === null) return 0;

  let count = 0;
  for (const item of state.selection) {
    const p = itemPoint(glyph, item);
    if (p !== null && (p.x !== Math.round(p.x) || p.y !== Math.round(p.y))) count += 1;
  }
  return count;
}
