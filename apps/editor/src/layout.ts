import type { ViewId } from "./components/TabBar.js";

/**
 * Which workspaces are on screen, and which of them the keyboard is in.
 *
 * One pane, or two. No two panes show the same workspace, with one exception:
 * a second Spacing line would need a second text and size, and a second Proof a
 * second paragraph, so asking for a workspace the other pane has swaps the two.
 *
 * The drawing is the exception. Two panes may both draw, on the same glyph and
 * the same camera, because what each of them *shows* is its own — the comb on
 * the one being worked and off the one being judged, handles here and none
 * there. The inspector and the strip stay single and follow the pane the
 * keyboard is in, since both are about the glyph rather than about a view of
 * it.
 *
 * Plain values and functions, so the rules can be tested without a window.
 * How the split is shaped — side by side or stacked, and where the divider is —
 * is a preference and lives in the store; which workspaces are showing is where
 * somebody is right now, and is not remembered.
 */
export type PaneIndex = 0 | 1;

export type Panes = {
  readonly first: ViewId;
  /** The second pane's workspace, or `null` while the window is not split. */
  readonly second: ViewId | null;
  /** The pane the keyboard follows: the one last clicked or tabbed into. */
  readonly active: PaneIndex;
};

/** The window as it opens: the font, alone. */
export const SINGLE_PANE: Panes = { first: "font", second: null, active: 0 };

export function viewIn(panes: Panes, index: PaneIndex): ViewId | null {
  return index === 0 ? panes.first : panes.second;
}

/** The workspace the keyboard is in. */
export function activeView(panes: Panes): ViewId {
  return viewIn(panes, panes.active) ?? panes.first;
}

const other = (index: PaneIndex): PaneIndex => (index === 0 ? 1 : 0);

/**
 * Show a workspace in a pane, which also makes it the active one.
 *
 * If the other pane is already showing it, the two swap rather than show it
 * twice.
 */
export function choosePane(panes: Panes, index: PaneIndex, view: ViewId): Panes {
  const here = viewIn(panes, index);
  if (here === null) return panes;
  if (here === view) return focusPane(panes, index);

  const there = viewIn(panes, other(index));
  // The drawing may be in both panes, so asking for it leaves the other pane
  // where it is instead of taking its workspace in exchange.
  const swapped = there === view && view !== "glyph" ? here : there;
  return index === 0
    ? { first: view, second: swapped, active: 0 }
    : { first: swapped ?? panes.first, second: view, active: 1 };
}

/**
 * Split the window. The new pane shows the drawing, which is what the split is
 * most often for, or the spacing line when the drawing is already showing.
 */
export function openSecondPane(panes: Panes): Panes {
  if (panes.second !== null) return panes;
  return { first: panes.first, second: panes.first === "glyph" ? "spacing" : "glyph", active: 1 };
}

/** Back to one pane, the first. */
export function closeSecondPane(panes: Panes): Panes {
  if (panes.second === null) return panes;
  return { first: panes.first, second: null, active: 0 };
}

/** Make a pane the active one. The same object when nothing changes, so React has nothing to do. */
export function focusPane(panes: Panes, index: PaneIndex): Panes {
  if (panes.active === index || viewIn(panes, index) === null) return panes;
  return { ...panes, active: index };
}

/**
 * Where a glyph opened from a pane is drawn.
 *
 * In the other pane, if that is the one drawing: the letter changes there and
 * the pane it was chosen from stays as it was, so a list or a spacing line can
 * be worked down one glyph after another. Otherwise the pane it was chosen from
 * turns to the drawing, as a single window always has.
 */
export function openGlyphFrom(panes: Panes, index: PaneIndex): Panes {
  if (viewIn(panes, other(index)) === "glyph") return panes;
  return choosePane(panes, index, "glyph");
}

/**
 * The pane the inspector and the strip belong to.
 *
 * Both are about the glyph rather than about a view of it, so there is one of
 * each however many panes are drawing. It sits in the pane the keyboard is in
 * when that pane is drawing, and otherwise in whichever pane is — which is the
 * only sensible answer while somebody works in the browser or the feature file
 * with a canvas open beside it.
 */
export function panelPane(panes: Panes): PaneIndex | null {
  if (activeView(panes) === "glyph") return panes.active;
  if (panes.first === "glyph") return 0;
  return panes.second === "glyph" ? 1 : null;
}

/**
 * Where a glyph opened from feature source is drawn.
 *
 * In the other pane whenever the window is split, whatever it was showing: the
 * name was chosen in a file, and the file is worth keeping in sight while the
 * glyph is looked at. A window of one turns to the drawing, as it does from
 * anywhere else.
 */
export function openGlyphBeside(panes: Panes, index: PaneIndex): Panes {
  return panes.second === null
    ? choosePane(panes, index, "glyph")
    : choosePane(panes, other(index), "glyph");
}
