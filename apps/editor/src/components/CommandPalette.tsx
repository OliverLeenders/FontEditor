import {
  catalog,
  listCatalog,
  loadUnicodeNames,
  nameWords,
  unicodeName,
  unicodeNamesReady,
} from "@typewright/catalog";
import { canOpenFolders } from "@typewright/disk";
import { newGlyphAdvance } from "@typewright/font-model";
import {
  type ToolId,
  alignSelection,
  canAlign,
  canDistribute,
  createGlyphs,
  distributeSelection,
} from "@typewright/tools";
import { useEffect, useMemo, useRef, useState } from "react";

import type { EditorStore } from "../store/index.js";
import { useEditorStore } from "../useStore.js";
import { openWindow } from "../windows.js";
import styles from "./CommandPalette.module.css";
import { itemsFor } from "./ContextMenu.js";
import { SearchIcon } from "./icons.js";
import type { ViewId } from "./TabBar.js";
import { TOOL_BUTTONS } from "./Toolbar.js";
import { ALIGNMENTS, DISTRIBUTIONS } from "./TransformPanel.js";

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
 *
 * It also goes to a glyph: typed as its name, its character, its code point or
 * what the standard calls it — the glyph browser's search, answered here. A
 * glyph the font has not got is offered to be made, and opened.
 */

export type Command = {
  readonly label: string;
  /** Which kind of command, shown beside it: "Go to", "Tool", "Selection"… */
  readonly group: string;
  readonly keys?: string;
  /** Said after the label, quieter: a glyph's character and what it is called. */
  readonly detail?: string;
  readonly run: () => void;
};

/** How many glyphs a search lists at most: the palette is for going somewhere. */
const GLYPHS_LISTED = 8;

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
  showHistory?: () => void,
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
    // Lining up and spacing, which have buttons in the inspector and no keys:
    // offered only while there is something for them to do.
    if (canAlign(store.editor)) {
      for (const { how, label } of ALIGNMENTS) {
        out.push({
          group: "Glyph",
          label,
          run: () => store.applyTool(alignSelection(store.editor, how)),
        });
      }
    }
    if (canDistribute(store.editor)) {
      for (const { along, label } of DISTRIBUTIONS) {
        out.push({
          group: "Glyph",
          label,
          run: () => store.applyTool(distributeSelection(store.editor, along)),
        });
      }
    }
    out.push(
      { group: "Go to", label: "Next glyph", keys: "PageDown", run: () => store.stepGlyph(1) },
      {
        group: "Go to",
        label: "Previous glyph",
        keys: "PageUp",
        run: () => store.stepGlyph(-1),
      },
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
  );
  if (showHistory !== undefined) {
    out.push({ group: "Edit", label: "Undo history…", keys: "Ctrl-Shift-H", run: showHistory });
  }
  out.push(
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

/**
 * The glyphs a search names, as commands to open them: the glyph browser's own
 * search over the whole font, in the font's order, and then the characters it
 * has not got that the search names, each offered to be made.
 *
 * `exact` are the ones typed in full — the name, the character, the code
 * point — which go above every command, since somebody who typed `a` in a
 * font with an `a` is more likely after the letter than after Add anchor.
 */
export function glyphCommands(
  store: EditorStore,
  typed: string,
  openGlyph: (name: string) => void,
): { readonly exact: Command[]; readonly rest: Command[] } {
  const q = typed.trim();
  if (q === "") return { exact: [], rest: [] };

  const document = store.editor.document;
  const found = listCatalog(catalog(document), { set: "all", search: q, order: "font" }).slice(
    0,
    GLYPHS_LISTED,
  );
  const explicit = /^(?:u\+|0x)([0-9a-f]{1,6})$/i.exec(q);
  const asked = explicit === null ? null : Number.parseInt(explicit[1]!, 16);

  const exact: Command[] = [];
  const rest: Command[] = [];
  for (const entry of found) {
    const code = entry.codePoint;
    const character = code === null ? "" : String.fromCodePoint(code);
    const said = code === null ? null : unicodeName(code);
    const detail = [character, said?.toLowerCase() ?? ""].filter((s) => s !== "").join("  ");
    const command: Command = entry.inFont
      ? {
          group: "Open",
          label: entry.name,
          ...(detail === "" ? {} : { detail }),
          run: () => openGlyph(entry.name),
        }
      : {
          group: "Make",
          label: entry.name,
          ...(detail === "" ? {} : { detail }),
          run: () => {
            if (code === null) return;
            const advance = newGlyphAdvance(document);
            store.applyTool(
              createGlyphs(store.editor, [{ name: entry.name, unicodes: [code] }], advance),
            );
            openGlyph(entry.name);
          },
        };
    const whole =
      entry.name.toLowerCase() === q.toLowerCase() ||
      (code !== null && (character === q || code === asked));
    (whole ? exact : rest).push(command);
  }
  return { exact, rest };
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
  onOpenGlyph,
  onShowHistory,
  onClose,
}: {
  readonly workspace: ViewId;
  readonly onWorkspace: (view: ViewId) => void;
  readonly onOpenGlyph: (name: string) => void;
  readonly onShowHistory?: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const store = useEditorStore();
  const [typed, setTyped] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const commands = useMemo(
    () => commandsFor(store, workspace, onWorkspace, onShowHistory),
    [store, workspace, onWorkspace, onShowHistory],
  );
  // The Unicode names, for a search that could be one for a name: unpacked
  // the first time one is typed, as the glyph browser does, and the list
  // made again once they are there.
  const [named, setNamed] = useState(unicodeNamesReady);
  const wantsNames = !named && nameWords(typed) !== null;
  useEffect(() => {
    if (!wantsNames) return;
    let watching = true;
    void loadUnicodeNames().then(() => {
      if (watching) setNamed(true);
    });
    return () => {
      watching = false;
    };
  }, [wantsNames]);

  const shown = useMemo(() => {
    const glyphs = glyphCommands(store, typed, onOpenGlyph);
    return [...glyphs.exact, ...matching(commands, typed), ...glyphs.rest];
    // `named` is not read here, but the glyphs found depend on it: the search
    // asks the table of names, which is empty until it turns true.
  }, [store, commands, typed, onOpenGlyph, named]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // The row the arrows choose stays in view as they go past the list's edge.
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

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
            placeholder="Type a command, or a glyph"
            aria-label="Command"
            data-own-undo=""
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
          <ul ref={list} className={styles.list} role="listbox" aria-label="Commands">
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
                <span className={styles.label}>
                  {command.label}
                  {command.detail === undefined ? null : (
                    <span className={styles.detail}>{command.detail}</span>
                  )}
                </span>
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
