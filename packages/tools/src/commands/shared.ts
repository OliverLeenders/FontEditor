import { type ToolResult, begin, commit, result } from "../effects.js";
import type { EditorState } from "../state.js";

/**
 * What every one-shot command hands back.
 *
 * A gesture spreads a transaction across many events - press, move, release -
 * and these happen all at once, so each opens and closes its own in a single
 * call. `null` means the edit could not be made and the state comes back
 * untouched, so a caller never has to check first.
 */
export function done(state: EditorState, next: EditorState | null, label: string): ToolResult {
  if (next === null) return result(state);
  return result(next, [begin(label, false), commit]);
}
