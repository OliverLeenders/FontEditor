import type { Vec2 } from "@fonteditor/geometry";
import {
  type Guide,
  type GuideId,
  type IdFactory,
  addGuide,
  distanceToGuide,
  guide,
  movedGuide,
  normalAngle,
  removeGuide,
  renamedGuide,
  setGuides,
  turnedGuide,
  updateGuide,
} from "@fonteditor/font-model";

import { screenTolerance } from "@fonteditor/view";

import { type ToolResult, begin, commit, result } from "../effects.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "../state.js";
import { done } from "./shared.js";

/**
 * Commands about guides: putting a line down, moving it, naming it, taking it
 * away.
 *
 * Two scopes, and every command here names which. A font's guide is drawn in
 * every glyph and belongs to the document; a glyph's belongs to the letter.
 * Which one you want is a decision — "the x-height is 512" is about the
 * typeface, "this diagonal starts here" is about the `k` — and it is not one an
 * editor can make for somebody, so it is an argument rather than a guess.
 */

export type GuideScope = "font" | "glyph";

/** Every guide in force for the glyph being drawn, with where it came from. */
export function guidesInForce(state: EditorState): { guide: Guide; scope: GuideScope }[] {
  const glyph = currentGlyph(state);
  return [
    ...state.document.guides.map((g) => ({ guide: g, scope: "font" as const })),
    ...(glyph?.guides ?? []).map((g) => ({ guide: g, scope: "glyph" as const })),
  ];
}

/** The guide with this id, whichever scope it is in. */
export function guideById(
  state: EditorState,
  id: GuideId,
): { guide: Guide; scope: GuideScope } | null {
  return guidesInForce(state).find((g) => g.guide.id === id) ?? null;
}

/**
 * Put a guide down at a point.
 *
 * On the grid, as a dragged one lands: a guide is a decision about where
 * something goes, and a decision that reads 631.9 was not one anybody made.
 */
export function addGuideAt(
  state: EditorState,
  at: Vec2,
  angle: number,
  scope: GuideScope,
  ids: IdFactory,
): ToolResult {
  const placed = guide(ids.guide(), { x: Math.round(at.x), y: Math.round(at.y) }, angle);

  if (scope === "font") {
    const document = setGuides(state.document, [...state.document.guides, placed]);
    return result({ ...state, document, selectedGuide: placed.id }, [
      begin("Add guide", false),
      commit,
    ]);
  }

  const document = editCurrentGlyph(state, (g) => addGuide(g, placed));
  if (document === null) return result(state);

  // Selected as it lands, so it can be named or nudged without being hunted
  // for, and the point selection goes: only one of the two can be what the next
  // key means.
  return result({ ...state, document, selection: [], selectedGuide: placed.id }, [
    begin("Add guide", false),
    commit,
  ]);
}

export function removeGuideAt(state: EditorState, id: GuideId): ToolResult {
  const next = withGuide(state, id, null);
  if (next === null) return result(state);

  const selectedGuide = state.selectedGuide === id ? null : state.selectedGuide;
  return done(state, { ...next, selectedGuide }, "Remove guide");
}

/** Take the selected guide away, which is what Backspace means while one is. */
export function deleteSelectedGuide(state: EditorState): ToolResult {
  return state.selectedGuide === null ? result(state) : removeGuideAt(state, state.selectedGuide);
}

/** Move a guide by a delta, which is what a drag and the arrow keys produce. */
export function moveGuideBy(state: EditorState, id: GuideId, dx: number, dy: number): ToolResult {
  const next = withGuide(state, id, (g) => movedGuide(g, dx, dy));
  return next === null ? result(state) : result(next, [begin("Move guide"), commit]);
}

/** Put a guide through an exact point, for a number typed into a field. */
export function moveGuideTo(state: EditorState, id: GuideId, at: Vec2): ToolResult {
  const next = withGuide(state, id, (g) =>
    g.pt.x === at.x && g.pt.y === at.y ? g : { ...g, pt: at },
  );
  return next === null ? result(state) : result(next, [begin("Move guide"), commit]);
}

export function turnGuideTo(state: EditorState, id: GuideId, angle: number): ToolResult {
  const next = withGuide(state, id, (g) =>
    normalAngle(angle) === g.angle ? g : turnedGuide(g, angle),
  );
  return next === null ? result(state) : result(next, [begin("Turn guide"), commit]);
}

export function renameGuideTo(state: EditorState, id: GuideId, name: string): ToolResult {
  const next = withGuide(state, id, (g) => (g.name === name ? g : renamedGuide(g, name)));
  // Coalescing: this is driven by a text field, and typing "stem" is four calls.
  return next === null ? result(state) : result(next, [begin("Name guide"), commit]);
}

/**
 * Move a guide between the font and this glyph.
 *
 * The one operation that needs both scopes at once, and worth having because
 * the scope is the thing people get wrong: a line drawn while working on `n`
 * turns out to be the stem width for the whole alphabet, and retyping it in the
 * font's list to find that out is the sort of chore that stops guides being
 * used at all.
 */
export function moveGuideToScope(state: EditorState, id: GuideId, scope: GuideScope): ToolResult {
  const found = guideById(state, id);
  if (found === null || found.scope === scope) return result(state);

  const taken = withGuide(state, id, null);
  if (taken === null) return result(state);

  if (scope === "font") {
    const document = setGuides(taken.document, [...taken.document.guides, found.guide]);
    return done(state, { ...taken, document }, "Guide to the font");
  }

  const document = editCurrentGlyph(taken, (g) => addGuide(g, found.guide));
  if (document === null) return result(state);
  return done(state, { ...taken, document }, "Guide to this glyph");
}

/**
 * How near the pointer has to come to a guide to catch it, in screen pixels.
 *
 * Generous, because a line is one pixel wide and nobody can point at one pixel.
 * Smaller than a node's reach, because everything on the outline is more likely
 * to be what was meant: a guide is picked up only where nothing else is.
 */
export const GUIDE_PIXELS = 5;

/**
 * The guide under a point, or `null`.
 *
 * The glyph's before the font's, and within each the last drawn first, so a
 * guide put down on top of another is the one that comes up — which is what
 * happens with everything else that overlaps on a canvas.
 */
export function pickGuide(state: EditorState, at: Vec2, pixels = GUIDE_PIXELS): GuideId | null {
  const reach = screenTolerance(state.view, pixels);

  let best: GuideId | null = null;
  let nearest = reach;
  for (const { guide: g } of guidesInForce(state)) {
    const away = Math.abs(distanceToGuide(g, at));
    // `<=` so a later guide wins a tie, which is the one drawn on top.
    if (away <= nearest) {
      nearest = away;
      best = g.id;
    }
  }
  return best;
}

/**
 * A document with one guide moved to pass through a point.
 *
 * For the drag, which owns the document it started from and needs the next one
 * rather than a `ToolResult`. `null` where the guide has gone.
 */
export function movedGuideIn(
  state: EditorState,
  id: GuideId,
  at: Vec2,
): EditorState["document"] | null {
  const next = withGuide(state, id, (g) =>
    g.pt.x === at.x && g.pt.y === at.y ? g : { ...g, pt: at },
  );
  return next === null ? null : next.document;
}

/**
 * Change or remove one guide, wherever it lives.
 *
 * `null` as the change removes it. Written once because every command above
 * needs the same two lines of "which list is it in", and getting that wrong
 * silently edits the wrong scope's copy.
 */
function withGuide(
  state: EditorState,
  id: GuideId,
  change: ((g: Guide) => Guide) | null,
): EditorState | null {
  const inFont = state.document.guides.some((g) => g.id === id);

  if (inFont) {
    const guides =
      change === null
        ? state.document.guides.filter((g) => g.id !== id)
        : state.document.guides.map((g) => (g.id === id ? change(g) : g));
    const document = setGuides(state.document, guides);
    return document === state.document ? null : { ...state, document };
  }

  const document = editCurrentGlyph(state, (g) =>
    change === null ? removeGuide(g, id) : updateGuide(g, id, change),
  );
  return document === null ? null : { ...state, document };
}
