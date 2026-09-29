import type { ToolId } from "@typewright/tools";
import { useEffect, useMemo, useRef, useState } from "react";

import { canOpenFolders } from "@typewright/disk";

import type { EditorStore } from "../store/index.js";
import { useEditorStore } from "../useStore.js";
import { openWindow } from "../windows.js";
import styles from "./CommandPalette.module.css";
import { itemsFor } from "./ContextMenu.js";
import { SearchIcon } from "./icons.js";
import type { ViewId } from "./TabBar.js";
import { TOOL_BUTTONS } from "./Toolbar.js";

/**
 * Every command, found by typing its name.
 *
 * The commands are spread over the canvas menu, the inspector's sections, the
 * toolbars and the File menu, and a person who knows what they want done does
 * not always know which of those holds it. Ctrl-K opens this over whatever is
 * on screen; typing narrows the list, the arrows choose and Enter runs.
 *
 * Built afresh each time it opens, from the same places the menus are built
 * from — the canvas menu for what can be done to the selection, the tools'
 * own list — so a command offered here is one offered there, and says the key
 * that does it where there is one.
 */

export type Command = {
  readonly label: string;
  /** Which kind of command, shown beside it: "Go to", "Tool", "Selection"… */
  readonly group: string;
  readonly keys?: string;
  readonly run: () => void;
};

const WORKSPACES: readonly { readonly id: ViewId; readonly label: string }[] = [
  { id: "font", label: "Font" },
  { id: "glyph", label: "Glyph" },
  { id: "spacing", label: "Spacing" },
  { id: "features", label: "Features" },
  { id: "proof", label: "Proof" },
];

/** The commands there are right now, for this store and this workspace. */
export function commandsFor(
  store: EditorStore,
  workspace: ViewId,
  goTo: (view: ViewId) => void,
): Command[] {
  const out: Command[] = [];

  for (const w of WORKSPACES) {
    if (w.id !== workspace) out.push({ group: "Go to", label: w.label, run: () => goTo(w.id) });
  }

  // The tools, and what can be done to what is selected: the drawing's own.
  for (const tool of TOOL_BUTTONS) {
    const id: ToolId | null = tool.id;
    if (id === null) continue;
    out.push({
      group: "Tool",
      label: tool.label,
      keys: tool.key,
      run: () => {
        goTo("glyph");
        store.setTool(id);
      },
    });
  }
  if (workspace === "glyph") {
    // The empty-canvas menu is what can be done to the glyph and the
    // selection without pointing at anything; the items that act on a place
    // under the pointer — an anchor or a guide put "here" — mean nothing from
    // a list, so they are left out.
    const menu = itemsFor(store, { x: 0, y: 0, target: null, point: { x: 0, y: 0 } });
    for (const item of menu) {
      if (item.kind !== "item" || item.disabled === true) continue;
      if (/here|guide/i.test(item.label)) continue;
      out.push({
        group: "Glyph",
        label: item.label,
        ...(item.keys === undefined ? {} : { keys: item.keys }),
        run: item.run,
      });
    }
    out.push(
      {
        group: "View",
        label: "Fit the glyph in the window",
        keys: "Ctrl-0",
        run: () => store.fitGlyph(),
      },
      {
        group: "View",
        label: "Show or hide the inspector",
        keys: "I",
        run: () => store.toggleInspector(),
      },
    );
  }

  out.push(
    { group: "Edit", label: "Undo", keys: "Ctrl-Z", run: () => store.undo() },
    { group: "Edit", label: "Redo", keys: "Ctrl-Shift-Z", run: () => store.redo() },
    { group: "File", label: "Fonts…", run: () => store.showProjects(true) },
    { group: "File", label: "New window", run: () => openWindow("fonts") },
  );
  if (canOpenFolders()) {
    out.push(
      { group: "File", label: "Save", keys: "Ctrl-S", run: () => void store.saveToFolder() },
      { group: "File", label: "Save as…", run: () => void store.saveFolderAs() },
      { group: "File", label: "Open folder…", run: () => void store.openFolder() },
    );
  }
  return out;
}

/** The commands matching what is typed: those starting with it first, then the rest. */
export function matching(commands: readonly Command[], typed: string): Command[] {
  const q = typed.trim().toLowerCase();
  if (q === "") return [...commands];
  const starts: Command[] = [];
  const within: Command[] = [];
  for (const c of commands) {
    const label = c.label.toLowerCase();
    const full = `${c.group} ${c.label}`.toLowerCase();
    if (label.startsWith(q)) starts.push(c);
    else if (label.includes(q) || full.includes(q)) within.push(c);
  }
  return [...starts, ...within];
}

export function CommandPalette({
  workspace,
  onWorkspace,
  onClose,
}: {
  readonly workspace: ViewId;
  readonly onWorkspace: (view: ViewId) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const store = useEditorStore();
  const [typed, setTyped] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const commands = useMemo(
    () => commandsFor(store, workspace, onWorkspace),
    [store, workspace, onWorkspace],
  );
  const shown = useMemo(() => matching(commands, typed), [commands, typed]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const run = (command: Command | undefined): void => {
    if (command === undefined) return;
    onClose();
    command.run();
  };

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.palette} role="dialog" aria-label="Commands">
        <label className={styles.search}>
          <SearchIcon />
          <input
            ref={input}
            className={styles.input}
            value={typed}
            placeholder="Type a command"
            aria-label="Command"
            onChange={(event) => {
              setTyped(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((i) => Math.min(shown.length - 1, i + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                run(shown[index]);
              }
            }}
          />
        </label>
        {shown.length === 0 ? (
          <p className={styles.none}>No command by that name</p>
        ) : (
          <ul className={styles.list} role="listbox" aria-label="Commands">
            {shown.map((command, i) => (
              <li
                key={`${command.group}-${command.label}`}
                role="option"
                aria-selected={i === index}
                className={styles.row}
                onPointerMove={() => setIndex(i)}
                onClick={() => run(command)}
              >
                <span className={styles.group}>{command.group}</span>
                <span className={styles.label}>{command.label}</span>
                {command.keys === undefined ? null : (
                  <kbd className={styles.keys}>{command.keys}</kbd>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
