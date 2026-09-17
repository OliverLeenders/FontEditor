/**
 * Every key the editor answers to, written down in one place.
 *
 * The editor grew to about forty commands and the only list of them was the
 * README, which is not open while anyone is drawing. Two of them — the tool
 * letters and the held `M` — are discoverable from a tooltip; the rest were
 * findable only by having been told.
 *
 * Data rather than markup, so it can be read back in a test. What a test can
 * check is that the list is not empty and that no group is; what it cannot check
 * is whether the list is *true*, since the keys are handled in half a dozen
 * components and there is no registry to compare against. Adding a key means
 * adding it here, and the sheet is worth more slightly stale than absent.
 */

export type Shortcut = {
  /**
   * The key or keys, as a person says them: "Ctrl-Z", "Shift-drag".
   *
   * Written out rather than built from a key code, because several of these are
   * gestures rather than presses — a drag with a modifier held is a shortcut in
   * every sense that matters to the person using it.
   */
  readonly keys: string;
  readonly what: string;
};

export type ShortcutGroup = {
  readonly title: string;
  /** What the group is about, where the title does not say it. */
  readonly note?: string;
  readonly items: readonly Shortcut[];
};

export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: "Anywhere",
    items: [
      { keys: "Ctrl-Z", what: "Undo" },
      { keys: "Ctrl-Shift-Z · Ctrl-Y", what: "Redo" },
      { keys: "Ctrl-S", what: "Save to the folder this font was opened from" },
      { keys: "? · F1", what: "This list" },
    ],
  },
  {
    title: "The font",
    note: "In the grid of glyphs.",
    items: [
      { keys: "Arrows", what: "Move through the glyphs" },
      { keys: "Home · End", what: "First and last glyph" },
      { keys: "Enter · double-click", what: "Open the glyph" },
      { keys: "F2", what: "Rename it" },
      { keys: "Backspace · Delete", what: "Delete it" },
    ],
  },
  {
    title: "The canvas",
    note: "Whichever tool is in hand.",
    items: [
      { keys: "V P K R E L", what: "Select, pen, knife, rectangle, ellipse, ruler line" },
      {
        keys: "M held",
        what: "Measure while it is down, and go back to drawing when it is let go",
      },
      { keys: "Page Up · Page Down", what: "The glyph before and after this one" },
      { keys: "Space held", what: "Show the drawing alone, without controls" },
      { keys: "Ctrl-0", what: "Fit the glyph in the window" },
      { keys: "Ctrl-wheel", what: "Zoom at the pointer" },
      { keys: "Wheel · middle-drag", what: "Pan" },
      { keys: "I", what: "Show or hide the inspector" },
      { keys: "H", what: "Handles near the work, or all of them always" },
      { keys: "S", what: "Snapping on or off" },
      { keys: "B", what: "Draw in the background, or back in the letter" },
      { keys: "Ctrl-A", what: "Select every point" },
      { keys: "Ctrl-C · Ctrl-X · Ctrl-V", what: "Copy, cut and paste contours" },
      { keys: "Escape", what: "Abandon whatever is being drawn or dragged" },
    ],
  },
  {
    title: "Select",
    items: [
      { keys: "Arrows", what: "Nudge the selection" },
      { keys: "Shift-arrows", what: "Nudge it further" },
      {
        keys: "Backspace · Delete",
        what: "Delete the selected points, anchor, guide or component",
      },
      { keys: "R", what: "Reverse the contour" },
      { keys: "Shift-click", what: "Add to the selection" },
      { keys: "double-click", what: "Take the whole contour" },
      { keys: "Alt-drag a handle", what: "Break a smooth node's handles apart" },
      { keys: "Shift-drag", what: "Hold the shape on a scale, or the angle on a turn" },
      { keys: "Alt-drag a corner", what: "Scale about the middle rather than the far corner" },
    ],
  },
  {
    title: "Pen",
    items: [
      { keys: "click", what: "A corner point" },
      { keys: "drag", what: "A smooth point, with its handles" },
      { keys: "Alt-drag", what: "Leave only the handle you dragged" },
      { keys: "click the first point", what: "Close the contour" },
      { keys: "Enter · Escape", what: "Finish, leaving it open" },
      { keys: "Backspace", what: "Take the last point back" },
    ],
  },
  {
    title: "Spacing and proof",
    items: [
      { keys: "[ · ]", what: "The letter before and after in the line" },
      { keys: "Arrows", what: "Move the sidebearing, or the kern between the pair" },
      { keys: "Shift-arrows", what: "Move it further" },
      { keys: "Alt-arrows", what: "The right sidebearing rather than the left" },
      { keys: "Ctrl-wheel", what: "Type size" },
      { keys: "Escape", what: "Let go of the letter" },
    ],
  },
  {
    title: "Feature source",
    note: "In the Features and Marks files.",
    items: [
      { keys: "Tab · Shift-Tab", what: "Indent and outdent" },
      { keys: "Escape then Tab", what: "Leave the source" },
      { keys: "Ctrl-Space", what: "Complete the name at the caret" },
      { keys: "↑ ↓ · Enter", what: "Choose a completion and take it" },
      { keys: "Ctrl-F · Ctrl-H", what: "Find, and find and replace" },
      { keys: "Enter · Shift-Enter", what: "The next and previous match, in the find field" },
      { keys: "Ctrl-click · F12", what: "Open the glyph a name is for" },
      { keys: "Ctrl-wheel", what: "Text size" },
    ],
  },
];
