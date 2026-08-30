import type { EditorState } from "./state.js";

/**
 * What a tool wants the history layer to do, alongside the state it produced.
 *
 * Nothing consumes these yet — `edit-core` is the next step. They exist now so
 * the transaction boundaries are decided by the tool that knows where they
 * belong, rather than being reverse-engineered later from a stream of state
 * changes. A drag emits exactly one `begin` and one `commit`, so it lands in
 * history as a single undoable step no matter how many pointer events it took.
 *
 * A gesture that changed nothing emits `abort` rather than `commit`: clicking a
 * node without moving it should not fill the undo stack with entries that undo
 * nothing, which is precisely what the prototype did on every mouse-up.
 */
export type Effect =
  | { readonly kind: "beginTransaction"; readonly label: string }
  | { readonly kind: "commitTransaction" }
  | { readonly kind: "abortTransaction" };

export type ToolResult = {
  readonly state: EditorState;
  readonly effects: readonly Effect[];
};

export function result(state: EditorState, effects: readonly Effect[] = []): ToolResult {
  return { state, effects };
}

export const begin = (label: string): Effect => ({ kind: "beginTransaction", label });
export const commit: Effect = { kind: "commitTransaction" };
export const abort: Effect = { kind: "abortTransaction" };
