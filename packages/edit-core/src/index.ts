/**
 * @fonteditor/edit-core
 *
 * Transactions, undo and redo.
 *
 * History is a list of document snapshots, which is cheap because the document
 * model is persistent: an unchanged contour exists once however deep the stack
 * goes, so memory is proportional to what changed rather than to what exists.
 * Undo is a reference swap.
 *
 * The transaction boundaries are the tools' own: a tool emits `begin` when a
 * gesture starts and `commit` when it ends, so a four-hundred-event drag lands
 * as one undoable step, and a gesture that moved nothing emits `abort` and
 * leaves no trace.
 */

export type { History, HistoryEntry, PushOptions } from "./history.js";
export {
  DEFAULT_COALESCE_MS,
  DEFAULT_LIMIT,
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

export type { EditSession, Pending } from "./session.js";
export {
  apply,
  canRedoSession,
  canUndoSession,
  redo,
  redoLabelOf,
  session,
  undo,
  undoLabelOf,
} from "./session.js";
