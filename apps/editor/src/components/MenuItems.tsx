import styles from "./ContextMenu.module.css";
import { CheckIcon, type IconComponent } from "./icons.js";

/**
 * A menu's rows, wherever the menu is.
 *
 * The canvas menu and the bar menus are the same thing in two places: a list of
 * actions, each with a drawing in the column before its words, separated into
 * groups. Two renderings of that would drift — a different gap, a different
 * tick, a different disabled colour — and the reader would learn the editor's
 * menus twice.
 *
 * So the rows live here and the stylesheet stays with the context menu, which
 * is where the look was settled.
 */

export type Item =
  | {
      readonly kind: "item";
      readonly label: string;
      /**
       * What the item does, as a drawing.
       *
       * A menu is read in a hurry, under the pointer, while looking at the
       * thing it is about. The shapes are what make that a glance rather than a
       * read — and the column they sit in is the one the tick uses, so a
       * checked item shows the tick instead. Nothing here needs both.
       */
      readonly icon?: IconComponent;
      readonly run: () => void;
      readonly checked?: boolean;
      /** Shown but not usable, for an action that is real here and not now. */
      readonly disabled?: boolean;
      /**
       * A word after the label: a count, a key, a state.
       *
       * Explicitly allowed to be `undefined` as well as absent, so a caller can
       * write `note: counted(n)` where the count is a word for several and
       * nothing at all for one.
       */
      readonly note?: string | undefined;
      /**
       * A sentence about the item, shown on hover rather than in the row.
       *
       * For what does not fit as a word. A sentence in the note column wraps,
       * and a menu whose rows break across three lines is read a fragment at a
       * time instead of down its left edge.
       */
      readonly hint?: string;
    }
  | { readonly kind: "separator" };

/**
 * The rows themselves.
 *
 * `onChose` is called after the item runs, and is how a menu closes: the item
 * says what it does and the menu decides what that means for the menu.
 */
export function MenuItems({
  items,
  onChose,
}: {
  readonly items: readonly Item[];
  readonly onChose: () => void;
}): React.JSX.Element {
  return (
    <>
      {items.map((item, index) =>
        item.kind === "separator" ? (
          <div key={`sep-${String(index)}`} className={styles.separator} role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitemcheckbox"
            aria-checked={item.checked ?? false}
            disabled={item.disabled ?? false}
            title={item.hint}
            className={styles.item}
            onClick={() => {
              item.run();
              onChose();
            }}
          >
            <span className={styles.mark} aria-hidden="true">
              <ItemMark item={item} />
            </span>
            <span className={styles.label}>{item.label}</span>
            {/* A space of its own, so the name a screen reader reads out is
                "Save Ctrl-S" rather than "SaveCtrl-S". */}
            {item.note === undefined ? null : (
              <>
                {" "}
                <span className={styles.note}>{item.note}</span>
              </>
            )}
          </button>
        ),
      )}
    </>
  );
}

/**
 * What goes in the column before an item's words.
 *
 * The tick where the item is a state that is on, its own drawing otherwise, and
 * nothing where it has neither — the column is kept in all three cases, so the
 * labels line up down the menu.
 */
function ItemMark({ item }: { item: Item & { kind: "item" } }): React.JSX.Element | null {
  if (item.checked === true) return <CheckIcon />;
  if (item.icon === undefined) return null;
  const Icon = item.icon;
  return <Icon />;
}
