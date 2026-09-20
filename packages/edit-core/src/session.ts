import { type FontDocument, withResolvedMetrics } from "@typewright/font-model";
import type { EditorState, ToolResult } from "@typewright/tools";
import type { Selection } from "@typewright/view";

import {
  type History,
  type PushOptions,
  canRedo,
  canUndo,
  history,
  pendingRedo,
  pendingUndo,
  push,
  redoLabel,
  stepBack,
  stepForward,
  undoLabel,
} from "./history.js";

/**
 * A transaction that has begun and not yet finished: the document and selection
 * as they were at the moment the gesture started.
 *
 * Captured from the state *before* the tool ran, not after — by the time
 * `pointerDown` returns, it has already changed the selection, and a step that
 * recorded that as its "before" would restore the wrong thing on undo.
 */
export type Pending = {
  readonly label: string;
  readonly document: FontDocument;
  readonly selection: Selection;
  /** Whether this step may merge with the one before it. */
  readonly coalesce: boolean;
};

/**
 * The editor plus its history.
 *
 * Note what history does *not* cover: the view transform, what is hovered or
 * focused, and any gesture in flight. Undo restores geometry and selection and
 * leaves the camera exactly where it was, because being teleported across the
 * canvas by an undo is disorienting and nobody asked for it.
 */
export type EditSession = {
  readonly editor: EditorState;
  readonly history: History;
  readonly pending: Pending | null;
};

export function session(editor: EditorState, limit?: number): EditSession {
  return { editor, history: history(limit), pending: null };
}

/**
 * Fold a tool's output into the session, honouring the transaction boundaries
 * the tool declared.
 *
 * The tools have emitted these effects since before any history existed, so
 * nothing about them changes here — which was the point of defining the seam
 * early. A tool knows where an undoable step begins and ends; inferring it later
 * from a stream of state changes would be guesswork.
 *
 * A committed step also leaves the font's spacing keys settled — see
 * {@link settledKeys}. This is the seam for it because a step is exactly the
 * unit that has to be consistent: the glyphs that follow the one just edited are
 * re-spaced inside the same step, so one undo takes back the edit and everything
 * that followed from it.
 */
export function apply(
  s: EditSession,
  outcome: ToolResult,
  now: number = Date.now(),
  options: PushOptions = {},
): EditSession {
  const before = s.editor;
  let state = outcome.state;
  let nextHistory = s.history;
  let pending = s.pending;

  for (const effect of outcome.effects) {
    switch (effect.kind) {
      case "beginTransaction":
        pending = {
          label: effect.label,
          document: before.document,
          selection: before.selection,
          coalesce: effect.coalesce ?? true,
        };
        break;

      case "commitTransaction": {
        if (pending === null) break;
        // Reference equality is exact here: the model is persistent, so an
        // unchanged document is the very same object. A gesture that touched
        // nothing leaves no step behind.
        if (pending.document !== state.document) {
          state = settledKeys(state);
          nextHistory = push(
            nextHistory,
            {
              label: pending.label,
              before: pending.document,
              after: state.document,
              selectionBefore: pending.selection,
              selectionAfter: state.selection,
              at: now,
            },
            // A step that asked not to coalesce gets a zero window, so it
            // stands alone however fast it followed the last one.
            pending.coalesce ? options : { ...options, coalesceMs: 0 },
          );
        }
        pending = null;
        break;
      }

      case "abortTransaction":
        pending = null;
        break;
    }
  }

  return { editor: state, history: nextHistory, pending };
}

/**
 * The editor with every glyph that takes its spacing from another moved and
 * widened to what that other glyph says now.
 *
 * A key is a rule — "my left side is `n`'s" — and until now it was followed only
 * where somebody asked what it worked out to: the fields that show it, and the
 * font as it was compiled. The document itself kept whatever numbers the keyed
 * glyph was last given, so editing `n` left `m` drawn and saved at its old
 * spacing, and the two only agreed again on export.
 *
 * So a step ends with the keys followed, and the numbers in the document are the
 * ones the keys say. Everything that draws a glyph — the canvas, the strip, the
 * spacing line, the proof — reads those numbers and needs to know nothing about
 * keys.
 *
 * Done on the commit rather than on every intermediate state: dragging a
 * sidebearing produces a document a hundred times a second, and none of those is
 * a state anybody has settled on. Keys that cannot be followed are left alone
 * and reported by preflight, which is where a broken key belongs.
 */
function settledKeys(state: EditorState): EditorState {
  const settled = withResolvedMetrics(state.document).document;
  return settled === state.document ? state : { ...state, document: settled };
}

/**
 * Step back one committed edit.
 *
 * Refused while a gesture is in flight: undoing out from under a drag would
 * leave the gesture holding a snapshot of a document that no longer exists.
 * Press Escape to abandon the drag first — that is what Escape is for.
 */
export function undo(s: EditSession): EditSession {
  if (s.pending !== null) return s;
  const entry = pendingUndo(s.history);
  if (entry === null) return s;

  return {
    editor: {
      ...s.editor,
      document: entry.before,
      selection: entry.selectionBefore,
      gesture: null,
      // The box round the selection stands upright again: how far the points
      // were turned is not in the history, so after stepping through it the
      // editor no longer knows, and a box left at an angle would be drawn round
      // a shape that is no longer at that angle.
      boxFrame: null,
    },
    history: stepBack(s.history),
    pending: null,
  };
}

export function redo(s: EditSession): EditSession {
  if (s.pending !== null) return s;
  const entry = pendingRedo(s.history);
  if (entry === null) return s;

  return {
    editor: {
      ...s.editor,
      document: entry.after,
      selection: entry.selectionAfter,
      gesture: null,
      boxFrame: null,
    },
    history: stepForward(s.history),
    pending: null,
  };
}

export function canUndoSession(s: EditSession): boolean {
  return s.pending === null && canUndo(s.history);
}

export function canRedoSession(s: EditSession): boolean {
  return s.pending === null && canRedo(s.history);
}

export function undoLabelOf(s: EditSession): string | null {
  return undoLabel(s.history);
}

export function redoLabelOf(s: EditSession): string | null {
  return redoLabel(s.history);
}
