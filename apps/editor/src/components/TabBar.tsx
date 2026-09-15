import type { SplitOrientation } from "../preferences.js";
import styles from "./TabBar.module.css";
import {
  CodeIcon,
  Columns2Icon,
  FileTextIcon,
  GapHorizontalIcon,
  GridIcon,
  type IconComponent,
  PenToolIcon,
  Rows2Icon,
  XIcon,
} from "./icons.js";

export type ViewId = "glyph" | "font" | "spacing" | "features" | "proof";

type Tab = {
  readonly id: ViewId;
  readonly label: string;
  readonly icon: IconComponent;
  readonly ready: boolean;
};

/*
 * Icon and label, never the icon alone. Five workspaces is few enough that the
 * words fit, and a picture of a workspace is a thing you learn once and then
 * recognise — which is worth having, and not worth paying for with a bar
 * nobody can read on their first afternoon.
 *
 * The one exception is a pane too narrow for the words, where the labels step
 * out of sight rather than push the bar off the edge. They stay the buttons'
 * names, and each tab still says its name when the pointer rests on it.
 */
const TABS: readonly Tab[] = [
  { id: "font", label: "Font", icon: GridIcon, ready: true },
  { id: "glyph", label: "Glyph", icon: PenToolIcon, ready: true },
  { id: "spacing", label: "Spacing", icon: GapHorizontalIcon, ready: true },
  { id: "features", label: "Features", icon: CodeIcon, ready: true },
  { id: "proof", label: "Proof", icon: FileTextIcon, ready: true },
];

/**
 * The workspaces, for one pane.
 *
 * The unbuilt ones are shown disabled rather than hidden. A font editor is
 * several workspaces, and seeing the shape of the whole thing is worth more than
 * pretending the app is smaller than it is — provided they are honestly marked
 * as not there yet.
 *
 * A split window has one bar per pane. The bar of a window of one offers to
 * split it; the second pane's bar offers to stack or unstack the panes and to
 * close itself. The pane the keyboard is in is marked along the top of its bar.
 */
export function TabBar({
  current,
  onSelect,
  glyphName,
  label = "Workspaces",
  active = false,
  orientation = "row",
  onSplit,
  onFlip,
  onClose,
}: {
  current: ViewId;
  onSelect: (id: ViewId) => void;
  glyphName: string;
  /** What this bar is called; two panes need two names. */
  label?: string;
  /** Whether this is the pane the keyboard is in, when there are two. */
  active?: boolean;
  /** How the panes are laid out, which decides what flipping them offers. */
  orientation?: SplitOrientation;
  /** Open a second pane. */
  onSplit?: (() => void) | undefined;
  /** Stack the panes, or put them back side by side. */
  onFlip?: (() => void) | undefined;
  /** Close this pane. */
  onClose?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <nav className={styles.bar} aria-label={label} data-active={active ? "" : undefined}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={styles.tab}
          aria-current={tab.id === current ? "page" : undefined}
          disabled={!tab.ready}
          title={tab.ready ? tab.label : "Not built yet"}
          onClick={() => onSelect(tab.id)}
        >
          <tab.icon />
          <span className={styles.label}>{tab.label}</span>
          {tab.id === "glyph" && glyphName !== "" ? (
            <span className={styles.detail}>{glyphName}</span>
          ) : null}
        </button>
      ))}
      {onSplit === undefined && onFlip === undefined && onClose === undefined ? null : (
        <span className={styles.actions}>
          {onSplit === undefined ? null : (
            <button
              type="button"
              className={styles.action}
              title="Open a second pane beside this one"
              aria-label="Split the window"
              onClick={onSplit}
            >
              <Columns2Icon />
            </button>
          )}
          {onFlip === undefined ? null : (
            <button
              type="button"
              className={styles.action}
              title={orientation === "row" ? "Stack the panes" : "Put the panes side by side"}
              aria-label={orientation === "row" ? "Stack the panes" : "Put the panes side by side"}
              onClick={onFlip}
            >
              {orientation === "row" ? <Rows2Icon /> : <Columns2Icon />}
            </button>
          )}
          {onClose === undefined ? null : (
            <button
              type="button"
              className={styles.action}
              title="Close this pane"
              aria-label="Close this pane"
              onClick={onClose}
            >
              <XIcon />
            </button>
          )}
        </span>
      )}
    </nav>
  );
}
