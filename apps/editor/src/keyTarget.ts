/**
 * What a key pressed somewhere in the window landed on, as the window's own
 * shortcuts need to know it.
 *
 * The window listens for its keys wherever the focus is, so each one has to ask
 * whether the key was meant for something else first. Worked out here rather
 * than inline in the handler, where three near-identical tests had drifted
 * apart: a textarea counted as typing for the clipboard but not for `?`.
 */
export type KeyTarget = {
  /** A field being typed in: an input, a textarea or a select. */
  readonly typing: boolean;
  /**
   * A field whose text is not the font's — the proof's text, the spacing
   * string, a search — which keeps its own undo. Ctrl-Z there is about what
   * was just typed in it; taking back an edit to the font instead, out of
   * sight, is two surprises for one key. The feature file is the font's, and
   * its typing is a step of the font's history, so it is not marked.
   */
  readonly ownUndo: boolean;
  /** A button, link or row of a list, which Space presses rather than previews. */
  readonly onControl: boolean;
};

export function keyTarget(target: EventTarget | null): KeyTarget {
  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement;
  const element = target instanceof Element ? target : null;
  return {
    typing,
    ownUndo: element?.closest("[data-own-undo]") != null,
    onControl:
      element?.closest("button, a, [role='option'], [role='menuitem'], [role='tab']") != null,
  };
}
