import type { FontDocument } from "@typewright/font-model";
import type { Selection } from "@typewright/view";

/**
 * One undoable step: the document either side of it, and the selection either
 * side of it.
 *
 * Snapshots, not patches — and the reasoning is worth recording, because the
 * architecture note that preceded this code argued the other way. The objection
 * to snapshots is memory: a hundred entries holding a hundred copies of the
 * document. That objection assumes a mutable model. This one is persistent —
 * every `font-model` function returns a new value that shares every contour and
 * node it did not touch — so an entry holds two *references*, and the parts that
 * did not change exist once no matter how deep the stack goes. Memory is already
 * proportional to what changed, which is the whole benefit patches were meant to
 * buy, and undo becomes a reference swap that cannot be subtly wrong.
 *
 * What snapshots do not give is a serializable delta, which a collaboration or
 * scripting layer would want on the wire. That can be derived later by diffing a
 * `before`/`after` pair; nothing here forecloses it.
 *
 * Selection is recorded because an undo that restores the geometry and leaves
 * you selecting nothing feels broken, even when the shapes are right.
 */
export type HistoryEntry = {
  readonly label: string;
  readonly before: FontDocument;
  readonly after: FontDocument;
  readonly selectionBefore: Selection;
  readonly selectionAfter: Selection;
  /** When the step was committed, for coalescing. */
  readonly at: number;
};

/**
 * `index` counts *applied* entries: `entries[index - 1]` is the step that would
 * be undone, and `entries[index]` is the one that would be redone. Keeping a
 * count rather than a cursor removes the off-by-one that an empty stack
 * otherwise creates.
 */
export type History = {
  readonly entries: readonly HistoryEntry[];
  readonly index: number;
  readonly limit: number;
};

export const DEFAULT_LIMIT = 200;
/** Steps of the same kind closer together than this merge into one. */
export const DEFAULT_COALESCE_MS = 500;

export function history(limit = DEFAULT_LIMIT): History {
  return { entries: [], index: 0, limit };
}

export function canUndo(h: History): boolean {
  return h.index > 0;
}

export function canRedo(h: History): boolean {
  return h.index < h.entries.length;
}

/** What Ctrl-Z would undo, for the Edit menu. */
export function undoLabel(h: History): string | null {
  return canUndo(h) ? h.entries[h.index - 1]!.label : null;
}

export function redoLabel(h: History): string | null {
  return canRedo(h) ? h.entries[h.index]!.label : null;
}

export type PushOptions = {
  readonly coalesceMs?: number;
};

/**
 * Record a step.
 *
 * Anything that had been undone is discarded first: editing after an undo
 * abandons the branch you undid, which is what every editor does and what users
 * expect.
 *
 * Consecutive steps with the same label, close together in time and contiguous
 * in the document, merge into one. Twelve arrow-key nudges should be one undo,
 * not twelve. Contiguity is checked by reference — the previous step's `after`
 * being the very same object as this step's `before` — which is exact and free
 * given the model is persistent.
 */
export function push(h: History, entry: HistoryEntry, options: PushOptions = {}): History {
  const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
  const kept = h.entries.slice(0, h.index);
  const previous = kept[kept.length - 1];

  const mergeable =
    previous !== undefined &&
    previous.label === entry.label &&
    entry.at - previous.at <= coalesceMs &&
    previous.after === entry.before;

  if (mergeable) {
    const merged: HistoryEntry = {
      label: previous.label,
      before: previous.before,
      after: entry.after,
      selectionBefore: previous.selectionBefore,
      selectionAfter: entry.selectionAfter,
      at: entry.at,
    };
    const entries = [...kept.slice(0, -1), merged];
    return { ...h, entries, index: entries.length };
  }

  return trim({ ...h, entries: [...kept, entry], index: kept.length + 1 });
}

/**
 * Drop the oldest steps once the stack passes its limit.
 *
 * The prototype's equivalent compared against `window.history` by accident and
 * shifted the array without keeping the cursor in step, so undo skipped a state
 * once the stack grew past a hundred. Here the index moves with the array.
 */
function trim(h: History): History {
  const excess = h.entries.length - h.limit;
  if (excess <= 0) return h;
  return {
    ...h,
    entries: h.entries.slice(excess),
    index: Math.max(0, h.index - excess),
  };
}

/** The step that undo would apply, or `null` at the bottom of the stack. */
export function pendingUndo(h: History): HistoryEntry | null {
  return canUndo(h) ? h.entries[h.index - 1]! : null;
}

/** The step that redo would apply, or `null` at the top. */
export function pendingRedo(h: History): HistoryEntry | null {
  return canRedo(h) ? h.entries[h.index]! : null;
}

export function stepBack(h: History): History {
  return canUndo(h) ? { ...h, index: h.index - 1 } : h;
}

export function stepForward(h: History): History {
  return canRedo(h) ? { ...h, index: h.index + 1 } : h;
}
