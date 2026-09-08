import styles from "./TabBar.module.css";
import {
  CodeIcon,
  FileTextIcon,
  GapHorizontalIcon,
  GridIcon,
  type IconComponent,
  PenToolIcon,
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
 */
const TABS: readonly Tab[] = [
  { id: "font", label: "Font", icon: GridIcon, ready: true },
  { id: "glyph", label: "Glyph", icon: PenToolIcon, ready: true },
  { id: "spacing", label: "Spacing", icon: GapHorizontalIcon, ready: true },
  { id: "features", label: "Features", icon: CodeIcon, ready: true },
  { id: "proof", label: "Proof", icon: FileTextIcon, ready: true },
];

/**
 * The workspaces.
 *
 * The unbuilt ones are shown disabled rather than hidden. A font editor is
 * several workspaces, and seeing the shape of the whole thing is worth more than
 * pretending the app is smaller than it is — provided they are honestly marked
 * as not there yet.
 */
export function TabBar({
  current,
  onSelect,
  glyphName,
}: {
  current: ViewId;
  onSelect: (id: ViewId) => void;
  glyphName: string;
}): React.JSX.Element {
  return (
    <nav className={styles.bar} aria-label="Workspaces">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={styles.tab}
          aria-current={tab.id === current ? "page" : undefined}
          disabled={!tab.ready}
          title={tab.ready ? undefined : "Not built yet"}
          onClick={() => onSelect(tab.id)}
        >
          <tab.icon />
          {tab.label}
          {tab.id === "glyph" && glyphName !== "" ? (
            <span className={styles.detail}>{glyphName}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
