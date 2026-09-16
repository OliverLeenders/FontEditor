import type { ViewId } from "./components/TabBar.js";

/**
 * Which workspaces are on screen, and which of them the keyboard is in.
 *
 * One pane, or two. Each shows a workspace of its own, and no two show the
 * same one: a second Spacing line would need a second text and size, and a
 * second canvas a second view of the glyph, when the point of the split is to
 * see two *different* things about one font at once. The glyph workspace in
 * particular exists once — its toolbar, inspector and strip are the window's —
 * so asking for a workspace the other pane has swaps the two.
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
  const swapped = there === view ? here : there;
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
