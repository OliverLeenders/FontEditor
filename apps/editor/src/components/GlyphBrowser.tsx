import { GLYPH_SETS, catalog, filterCatalog, setCounts } from "@typewright/catalog";
import { CanvasSurface, DARK_PALETTE, LIGHT_PALETTE, drawGlyphCell } from "@typewright/render";
import {
  deleteGlyph,
  duplicateGlyph,
  duplicateName,
  renameCurrentGlyph,
  roundGlyphAt,
  setMarkColor,
} from "@typewright/tools";
import { MARK_COLORS, NOTDEF, drawableGlyph, sameMarkColor } from "@typewright/font-model";
import {
  type GridLayout,
  cellBox,
  cellIndexAt,
  gridLayout,
  scrollToCell,
  visibleCells,
} from "@typewright/view";
import { useEffect, useMemo, useRef, useState } from "react";

import { isDarkNow, watchScheme } from "../scheme.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import { type Item, Menu } from "./ContextMenu.js";
import { CopyPlusIcon, GridIcon, PenToolIcon, TrashIcon, TypeIcon } from "./icons.js";
import { markSwatch } from "./MarkSwatch.js";
import { CleanUpMenu } from "./CleanUpMenu.js";
import { ExportFont } from "./ExportFont.js";
import { FileMenu } from "./FileMenu.js";
import { Masters } from "./Masters.js";
import { Preflight } from "./Preflight.js";
import { FontInfoPanel } from "./FontInfoPanel.js";
import { Sheet } from "./Sheet.js";
import { Snapshots } from "./Snapshots.js";
import { Tracing } from "./Tracing.js";
import { NewGlyph } from "./NewGlyph.js";
import styles from "./GlyphBrowser.module.css";

/** Where the Unicode blocks begin in the set list, for a divider. */
const FIRST_BLOCK = GLYPH_SETS.findIndex((set) => set.id.startsWith("block:"));

/**
 * The glyph browser: every glyph in the font, filtered and searchable.
 *
 * The grid is one canvas rather than a few thousand elements. A real font runs
 * to thousands of glyphs, and only the rows scrolled into view are ever drawn,
 * so the cost of a frame is set by the size of the window rather than the size
 * of the font. Cells go through the same renderer as everything else, which is
 * what stops a glyph looking like one thing here and another in the editor.
 *
 * What elements would have given us free — focus, hover, keyboard movement — is
 * written out explicitly instead. That is the price of the canvas, and it is
 * paid here rather than being quietly skipped.
 */
export function GlyphBrowser({ onOpen }: { onOpen: (name: string) => void }): React.JSX.Element {
  const store = useEditorStore();
  const document = useStoreValue((s) => s.session.editor.document);
  const query = useStoreValue((s) => s.catalogQuery);
  const currentGlyph = useStoreValue((s) => s.session.editor.currentGlyph);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<CanvasSurface | null>(null);
  const [focused, setFocused] = useState(0);
  const [width, setWidth] = useState(0);

  // Rebuilt only when the font changes, not on every keystroke: walking every
  // glyph's contours to ask "is this drawn?" is what would make typing in the
  // search box feel heavy on a large font.
  // The scroller's width is state rather than a ref because the grid's height
  // is derived from it, and a ref changing does not re-render — which is exactly
  // how the spacer came to be stuck at zero and the grid refused to scroll.
  //
  // `clientWidth` excludes the scrollbar, and the stylesheet reserves the gutter
  // permanently, so this cannot oscillate between "tall enough to overflow" and
  // "narrow enough not to".
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) return;

    const measure = (): void => setWidth(scroller.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const entries = useMemo(() => catalog(document), [document]);
  const counts = useMemo(() => setCounts(entries), [entries]);
  const shown = useMemo(() => filterCatalog(entries, query), [entries, query]);

  // One layout, computed in render, used by the spacer, the keyboard and the
  // canvas alike. Deriving it separately in the frame callback is what let the
  // two disagree.
  const layout: GridLayout = useMemo(() => gridLayout(shown.length, width), [shown.length, width]);
  const columns = layout.columns;

  // What the frame callback reads. Held in a ref so that installing the surface
  // does not depend on it — otherwise the canvas would be torn down and rebuilt
  // on every keystroke.
  const frame = useRef({ shown, document, focused, currentGlyph, layout });
  frame.current = { shown, document, focused, currentGlyph, layout };

  useEffect(() => {
    const canvas = canvasRef.current;
    const scroller = scrollRef.current;
    if (canvas === null || scroller === null) return;

    const surface = new CanvasSurface(canvas, (ctx, size) => {
      const state = frame.current;
      const dark = isDarkNow();
      const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;

      const layout = state.layout;
      ctx.clearRect(0, 0, size.width, size.height);
      const scrollTop = scroller.scrollTop;
      const range = visibleCells(layout, scrollTop, size.height);
      if (range === null) return;

      const { info } = state.document;
      const metrics = {
        unitsPerEm: info.unitsPerEm,
        ascender: info.ascender,
        descender: info.descender,
      };
      const focusedName = state.shown[state.focused]?.name ?? null;

      for (let i = range.first; i <= range.last; i++) {
        const entry = state.shown[i];
        const box = cellBox(layout, i);
        if (entry === undefined || box === null) continue;

        // Content coordinates to viewport coordinates. The canvas stays the size
        // of the viewport however tall the grid gets; only this offset moves.
        const cellGlyph = entry.drawn ? state.document.glyphs[entry.name] : undefined;
        drawGlyphCell(
          ctx,
          // Components drawn in, so a composite shows the letter it is made of.
          cellGlyph === undefined ? null : drawableGlyph(state.document, cellGlyph),
          { x: box.x, y: box.y - scrollTop, width: box.width, height: box.height },
          palette,
          metrics,
          {
            name: entry.name,
            codePoint: entry.codePoint,
            focused: entry.name === focusedName,
            current: entry.name === state.currentGlyph,
            markColor: state.document.glyphs[entry.name]?.markColor ?? null,
          },
        );
      }
    });

    surfaceRef.current = surface;
    surface.start();

    const invalidate = (): void => surface.invalidate();
    scroller.addEventListener("scroll", invalidate, { passive: true });
    const stopWatching = watchScheme(invalidate);

    return () => {
      scroller.removeEventListener("scroll", invalidate);
      stopWatching();
      surface.destroy();
      surfaceRef.current = null;
    };
  }, []);

  // Redraw when what is shown changes. The canvas itself never re-renders.
  useEffect(() => {
    surfaceRef.current?.invalidate();
  }, [shown, focused, currentGlyph, document, layout]);

  // A filter that shortens the list must not strand focus past its end.
  useEffect(() => {
    setFocused((f) => Math.min(f, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  /** The cell being renamed, and the draft text over it. */
  const [renaming, setRenaming] = useState<{ index: number; draft: string } | null>(null);
  // Followed only while a cell is being renamed, so an ordinary scroll through
  // several thousand glyphs does not re-render anything.
  const [renameScroll, setRenameScroll] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);

  /**
   * Rename the glyph in a cell.
   *
   * Goes through the same command the inspector uses, which renames the *open*
   * glyph — so the glyph is opened first. That is not a workaround: renaming a
   * glyph you cannot see, from a grid where the next cell along looks much the
   * same, is how the wrong one gets renamed.
   */
  const commitRename = (index: number, to: string): void => {
    const name = shown[index]?.name;
    setRenaming(null);
    if (name === undefined || to.trim() === "" || to.trim() === name) return;

    store.setCurrentGlyph(name);
    store.applyTool(renameCurrentGlyph(store.editor, to));
  };

  const startRename = (index: number): void => {
    const name = shown[index]?.name;
    if (name === undefined || name === NOTDEF) return;
    setRenameScroll(scrollRef.current?.scrollTop ?? 0);
    setRenaming({ index, draft: name });
  };

  /**
   * A copy waiting to be renamed, by name.
   *
   * The copy is not in the list until the store has it and the list has been
   * worked out again, so the rename is started once it turns up rather than
   * straight after the command — at which point there is no cell to put it on.
   * A copy filtered out of the set on screen is simply not renamed here.
   */
  const [pendingRename, setPendingRename] = useState<string | null>(null);
  useEffect(() => {
    if (pendingRename === null) return;
    const index = shown.findIndex((entry) => entry.name === pendingRename);
    setPendingRename(null);
    if (index < 0) return;
    setFocused(index);
    startRename(index);
  }, [pendingRename, shown]);

  /**
   * Where the cell being renamed is on screen.
   *
   * `null` once it scrolls out of view, which also takes the field away — a
   * rename field floating over a cell that is no longer there belongs to
   * nothing.
   */
  const renamingBox = useMemo(() => {
    if (renaming === null) return null;
    const box = cellBox(layout, renaming.index);
    if (box === null) return null;
    return { ...box, y: box.y - renameScroll };
  }, [renaming, layout, renameScroll]);

  /** What the menu offers for one cell. */
  const cellItems = (index: number): Item[] => {
    const name = shown[index]?.name;
    if (name === undefined) return [];
    const markColor = document.glyphs[name]?.markColor ?? null;

    return [
      { kind: "item", label: "Open", icon: PenToolIcon, run: () => openAt(index) },
      {
        kind: "item",
        label: "Rename…",
        icon: TypeIcon,
        // `.notdef` is found by name when a font is written, so renaming it
        // loses the glyph rather than relabelling it.
        disabled: name === NOTDEF,
        run: () => startRename(index),
      },
      {
        kind: "item",
        label: "Duplicate",
        icon: CopyPlusIcon,
        // A second `.notdef` is a glyph no font is allowed.
        disabled: name === NOTDEF,
        run: () => {
          const copy = duplicateName(store.editor, name);
          store.applyTool(duplicateGlyph(store.editor, name));
          setPendingRename(copy);
        },
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Round coordinates",
        icon: GridIcon,
        run: () => {
          store.setCurrentGlyph(name);
          store.applyTool(roundGlyphAt(store.editor, name));
        },
      },
      { kind: "separator" },
      // The colour marks, each drawn as itself and ticked when it is the one on
      // this glyph: a row of words would have to be read, and a mark is
      // recognised.
      ...MARK_COLORS.map((mark): Item => ({
        kind: "item",
        label: mark.name,
        icon: markSwatch(mark.value),
        checked: sameMarkColor(markColor, mark.value),
        run: () => store.applyTool(setMarkColor(store.editor, name, mark.value)),
      })),
      {
        kind: "item",
        label: "No colour",
        disabled: markColor === null,
        run: () => store.applyTool(setMarkColor(store.editor, name, null)),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Delete",
        icon: TrashIcon,
        // Kept for the same reason it cannot be renamed: a font needs one, and
        // what the export would put back is a blank.
        disabled: name === NOTDEF,
        run: () => store.applyTool(deleteGlyph(store.editor, name)),
      },
    ];
  };

  const openAt = (index: number): void => {
    const entry = shown[index];
    if (entry !== undefined) onOpen(entry.name);
  };

  const moveFocus = (next: number): void => {
    const clamped = Math.max(0, Math.min(shown.length - 1, next));
    setFocused(clamped);

    const scroller = scrollRef.current;
    if (scroller === null) return;
    const target = scrollToCell(layout, clamped, scroller.scrollTop, scroller.clientHeight);
    if (target !== null) scroller.scrollTop = target;
  };

  return (
    <div className={styles.browser}>
      <aside className={styles.sets} aria-label="Glyph sets">
        {GLYPH_SETS.map((set, index) => {
          const count = counts.get(set.id) ?? 0;
          return (
            <button
              key={set.id}
              type="button"
              className={
                index === FIRST_BLOCK ? `${styles.set} ${styles.sectionStart}` : styles.set
              }
              aria-current={set.id === query.set ? "true" : undefined}
              // A block the font has nothing in is greyed rather than hidden:
              // "Cyrillic 0" answers the question; an absent row does not.
              data-empty={count === 0 ? "true" : undefined}
              onClick={() => store.setCatalogQuery({ set: set.id })}
            >
              <span className={styles.setLabel}>{set.label}</span>
              <span className={styles.setCount}>{count}</span>
            </button>
          );
        })}
      </aside>

      <div className={styles.main}>
        <div className={styles.bar}>
          {/* The font as a file, and copies of it going out. Two menus, because
              this is a subject rather than a row of buttons — and because the
              bar's width is worth more to the work than to the things somebody
              does once at each end of a session. */}
          <div className={styles.group}>
            <FileMenu />
            <ExportFont />
            <CleanUpMenu />
          </div>

          {/* What the font holds, each behind the button that opens it. These
              stay in the open: they are places you go and come back from, and
              a menu in front of them would be a disclosure in front of a
              disclosure. */}
          <div className={styles.group}>
            <FontInfoPanel />
            <Masters />
            <Tracing />
            <Sheet />
            <Preflight />
            <Snapshots />
          </div>

          {/* And the list below: what is in it, what order it is in, and the
              way to add to it. */}
          <div className={`${styles.group} ${styles.listControls}`}>
            <NewGlyph />
            <input
              type="search"
              className={styles.search}
              placeholder="Name, U+0041, or a character"
              value={query.search}
              aria-label="Search glyphs"
              onChange={(event) => store.setCatalogQuery({ search: event.target.value })}
            />
            <label className={styles.orderLabel}>
              Sort
              <select
                className={styles.order}
                value={query.order}
                onChange={(event) =>
                  store.setCatalogQuery({ order: event.target.value as typeof query.order })
                }
              >
                <option value="font">Font order</option>
                <option value="codePoint">Code point</option>
                <option value="name">Name</option>
              </select>
            </label>
            <span className={styles.count}>
              {shown.length === entries.length
                ? `${String(entries.length)} glyphs`
                : `${String(shown.length)} of ${String(entries.length)}`}
            </span>
          </div>
        </div>

        <div className={styles.gridArea}>
          <div
            ref={scrollRef}
            className={styles.scroller}
            tabIndex={0}
            role="grid"
            aria-label="Glyphs"
            aria-rowcount={Math.ceil(shown.length / Math.max(1, columns))}
            onKeyDown={(event) => {
              if (event.ctrlKey || event.metaKey) return;
              const moves: Record<string, number | undefined> = {
                ArrowRight: focused + 1,
                ArrowLeft: focused - 1,
                ArrowDown: focused + columns,
                ArrowUp: focused - columns,
                Home: 0,
                End: shown.length - 1,
              };
              const next = moves[event.key];
              if (next !== undefined) {
                event.preventDefault();
                moveFocus(next);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                openAt(focused);
                return;
              }
              if (event.key === "F2") {
                event.preventDefault();
                startRename(focused);
                return;
              }
              // Undo is the safety net, so this does not stop to ask: a
              // confirmation on something one keystroke from reversible is
              // friction rather than protection.
              if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                const name = shown[focused]?.name;
                if (name !== undefined) store.applyTool(deleteGlyph(store.editor, name));
              }
            }}
            onScroll={(event) => {
              if (renaming !== null) setRenameScroll(event.currentTarget.scrollTop);
            }}
            onClick={(event) => {
              const index = cellFromEvent(event, scrollRef.current, layout);
              if (index !== null) setFocused(index);
            }}
            onDoubleClick={(event) => {
              const index = cellFromEvent(event, scrollRef.current, layout);
              if (index !== null) openAt(index);
            }}
            onContextMenu={(event) => {
              const index = cellFromEvent(event, scrollRef.current, layout);
              if (index === null) return;
              event.preventDefault();
              setFocused(index);
              setMenu({ x: event.clientX, y: event.clientY, index });
            }}
          >
            {/* Gives the scroller its true height. The canvas stays
                viewport-sized and repaints as this moves beneath it. */}
            <div
              className={styles.content}
              style={{ height: `${String(layout.contentHeight)}px` }}
            />
          </div>
          <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />

          {/* The grid is drawn on a canvas, so the field for renaming a cell has
              to be placed over it from the same layout the drawing used. Sitting
              on the cell rather than in a dialog is the point: which glyph is
              being renamed should not be something you have to remember. */}
          {renamingBox === null || renaming === null ? null : (
            <input
              className={styles.rename}
              style={{
                left: `${String(renamingBox.x)}px`,
                top: `${String(renamingBox.y + renamingBox.height - 18)}px`,
                width: `${String(renamingBox.width)}px`,
              }}
              value={renaming.draft}
              aria-label="Rename glyph"
              spellCheck={false}
              autoFocus
              onChange={(event) => setRenaming({ ...renaming, draft: event.target.value })}
              onBlur={() => commitRename(renaming.index, renaming.draft)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") commitRename(renaming.index, renaming.draft);
                if (event.key === "Escape") setRenaming(null);
              }}
            />
          )}
        </div>

        {menu === null ? null : (
          <Menu x={menu.x} y={menu.y} items={cellItems(menu.index)} onClose={() => setMenu(null)} />
        )}

        {shown.length === 0 ? (
          <p className={styles.empty}>
            No glyphs match. Try {query.search === "" ? "another set" : "a different search"}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Which cell a mouse event landed on, in the grid's content coordinates. */
function cellFromEvent(
  event: { clientX: number; clientY: number },
  scroller: HTMLDivElement | null,
  layout: GridLayout,
): number | null {
  if (scroller === null) return null;
  const box = scroller.getBoundingClientRect();
  return cellIndexAt(
    layout,
    event.clientX - box.left,
    event.clientY - box.top + scroller.scrollTop,
  );
}
