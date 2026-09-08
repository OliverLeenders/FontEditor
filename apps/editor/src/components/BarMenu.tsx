import { useEffect, useRef, useState } from "react";

import menu from "./BarMenu.module.css";
import { type Item, MenuItems } from "./MenuItems.js";
import open from "./OpenFont.module.css";
import { type IconComponent } from "./icons.js";

/**
 * A button in a bar, and the thing that opens under it.
 *
 * Six panels had written this out for themselves — the open flag, the ref, a
 * capture-phase pointerdown that closes on a click elsewhere, an Escape
 * listener, `aria-expanded` — and six copies of a rule is six chances for one
 * of them to close differently from the rest.
 *
 * Two kinds of thing hang off it, and the difference is real. A *menu* is a
 * list of actions: you press one and it closes, and it is built from `Item`s so
 * every menu in the editor is drawn the same way, canvas and bar alike. A
 * *panel* is somewhere you stay — the masters, the snapshots, the font's
 * metadata — and it holds whatever its own component renders.
 */
export function BarMenu({
  label,
  icon: Icon,
  title,
  disabled = false,
  badge,
  panelLabel,
  panelClassName,
  items,
  onOpen,
  closeOnOutside = true,
  children,
}: {
  readonly label: string;
  readonly icon?: IconComponent | undefined;
  readonly title?: string | undefined;
  readonly disabled?: boolean;
  /** A mark on the button itself, for state that must not hide behind a fold. */
  readonly badge?: React.ReactNode | undefined;
  readonly panelLabel?: string | undefined;
  /** The panel's own stylesheet class, for the panels that size themselves. */
  readonly panelClassName?: string | undefined;
  /** A menu's rows. Given these, the panel is a menu and closes when one runs. */
  readonly items?: readonly Item[] | undefined;
  /** Called when it opens, for a panel that reads something first. */
  readonly onOpen?: (() => void) | undefined;
  /**
   * Whether a press outside closes it.
   *
   * True for everything that is a list of things to press. False for a panel
   * somebody works *in* while looking at the canvas behind it, where a stray
   * press outside is part of the work rather than a way of leaving.
   */
  readonly closeOnOutside?: boolean;
  /** A panel's contents, given the way to close it. */
  readonly children?: React.ReactNode | ((close: () => void) => React.ReactNode) | undefined;
}): React.JSX.Element {
  const [shown, setShown] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  // What a panel wants read before it is looked at. Held in a ref so that
  // opening is the only thing that runs it: a caller writes the callback inline,
  // so it is a new function on every render, and depending on it directly would
  // re-read the disk as fast as the bar re-rendered.
  const opener = useRef(onOpen);
  opener.current = onOpen;

  useEffect(() => {
    if (!shown) return;
    opener.current?.();
  }, [shown]);

  useEffect(() => {
    if (!shown) return;

    const onDown = (event: MouseEvent): void => {
      if (!closeOnOutside) return;
      if (holder.current !== null && !holder.current.contains(event.target as Node)) {
        setShown(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Not while a field has it. This listener is on the window and in the
      // capture phase, so it runs before the field's own handler and would
      // close the panel out from under an edit somebody was abandoning — which
      // is two things happening for one key.
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
      setShown(false);
    };
    // Capture, so a press on something that stops propagation still closes it.
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [shown, closeOnOutside]);

  const close = (): void => setShown(false);

  return (
    <div className={menu.holder} ref={holder}>
      <button
        type="button"
        className={open.button}
        aria-expanded={shown}
        aria-haspopup={items === undefined ? "dialog" : "menu"}
        disabled={disabled}
        title={title}
        onClick={() => setShown((was) => !was)}
      >
        {Icon === undefined ? null : <Icon />}
        {label}
        {badge}
        <span className={menu.caret} aria-hidden="true" />
      </button>

      {shown ? (
        <div
          className={panelClassName ?? (items === undefined ? menu.panel : menu.menu)}
          role={items === undefined ? "group" : "menu"}
          aria-label={panelLabel ?? label}
        >
          {items === undefined ? null : <MenuItems items={items} onChose={close} />}
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}
