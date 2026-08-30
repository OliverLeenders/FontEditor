import styles from "./TabBar.module.css";

export type ViewId = "glyph" | "font" | "spacing" | "features" | "proof";

type Tab = { readonly id: ViewId; readonly label: string; readonly ready: boolean };

const TABS: readonly Tab[] = [
  { id: "font", label: "Font", ready: true },
  { id: "glyph", label: "Glyph", ready: true },
  { id: "spacing", label: "Spacing", ready: false },
  { id: "features", label: "Features", ready: false },
  { id: "proof", label: "Proof", ready: false },
];

/**
 * The workspaces, only one of which exists yet.
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
}): JSX.Element {
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
          {tab.label}
          {tab.id === "glyph" && glyphName !== "" ? (
            <span className={styles.detail}>{glyphName}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
