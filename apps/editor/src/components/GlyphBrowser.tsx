import {
  GLYPH_SETS,
  catalog,
  listCatalog,
  loadUnicodeNames,
  setCounts,
  unicodeName,
} from "@typewright/catalog";
import {
  CanvasSurface,
  DARK_PALETTE,
  LIGHT_PALETTE,
  drawGlyphCell,
  formatCodePoint,
  sampleText,
} from "@typewright/render";
import {
  createGlyphs,
  deleteGlyphs,
  duplicateGlyph,
  duplicateName,
  renameCurrentGlyph,
  roundGlyphsAt,
  setMarkColors,
} from "@typewright/tools";
import {
  type FontDocument,
  BACKGROUND,
  MARK_COLORS,
  NOTDEF,
  layerLabel,
  drawableGlyph,
  sameMarkColor,
} from "@typewright/font-model";
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
import { wholeOf } from "../store/masters.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import { type Item, Menu } from "./ContextMenu.js";
import {
  ArrowLeftRightIcon,
  CopyIcon,
  CopyPlusIcon,
  GridIcon,
  PenToolIcon,
  SquarePlusIcon,
  TrashIcon,
  TypeIcon,
} from "./icons.js";
import { markSwatch } from "./MarkSwatch.js";
import { CleanUpMenu } from "./CleanUpMenu.js";
import { ExportFont } from "./ExportFont.js";
import { FileMenu } from "./FileMenu.js";
import { Masters } from "./Masters.js";
import { Preflight } from "./Preflight.js";
import { FontInfoPanel } from "./FontInfoPanel.js";
import { Designspace } from "./Designspace.js";
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
  // A master that draws only some glyphs is shown as the whole font, with what
  // it does not draw faint: the whole master it is a layer of supplies the rest.
  const sparseName = useStoreValue(
    (s) => s.project.masters.find((m) => m.id === s.project.current && m.sparse)?.name ?? null,
  );
  const whole = useStoreValue((s) => wholeOf(s.project));
  useEffect(() => {
    if (sparseName !== null && whole === null) void store.loadWhole();
  }, [sparseName, whole, store]);
  const grid = useMemo(() => withWhole(document, whole), [document, whole]);
  const absent = (name: string): boolean => whole !== null && document.glyphs[name] === undefined;
  /** A glyph this master does not draw, which somebody has asked to open. */
  const [offer, setOffer] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<CanvasSurface | null>(null);
  const [focused, setFocused] = useState(0);
  const [width, setWidth] = useState(0);
  // The cells picked with ctrl and shift, by name so that a pick survives the
  // list being sorted, and where a shift-click runs from.
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState(0);

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

  const entries = useMemo(() => catalog(grid), [grid]);
  const counts = useMemo(() => setCounts(entries), [entries]);
  // Every glyph the query keeps, and every code point it covers that the font
  // has not got — see `listCatalog`. The second kind is a cell to be made
  // rather than one to open, and is left out of everything that acts on a
  // glyph: it has no name in the font to act on.
  const shown = useMemo(() => listCatalog(entries, query), [entries, query]);
  const toMake = useMemo(() => shown.filter((entry) => !entry.inFont).length, [shown]);
  const inFont = (index: number): string | null => {
    const entry = shown[index];
    return entry === undefined || !entry.inFont ? null : entry.name;
  };

  // One layout, computed in render, used by the spacer, the keyboard and the
  // canvas alike. Deriving it separately in the frame callback is what let the
  // two disagree.
  const layout: GridLayout = useMemo(() => gridLayout(shown.length, width), [shown.length, width]);
  const columns = layout.columns;

  /*
   * What the menu and the Delete key act on: the cells picked, in the order
   * shown, or the focused one where none are.
   *
   * Only what is shown counts. A glyph picked and then filtered out of sight is
   * not deleted with the others, because nobody deletes what they cannot see
   * on purpose.
   */
  const selection = useMemo(() => {
    const names = shown
      .filter((entry) => entry.inFont && picked.has(entry.name))
      .map((entry) => entry.name);
    if (names.length > 0) return names;
    const at = shown[focused];
    return at === undefined || !at.inFont ? [] : [at.name];
  }, [shown, picked, focused]);
  const selectionSet = useMemo(() => new Set(selection), [selection]);

  // What the frame callback reads. Held in a ref so that installing the surface
  // does not depend on it — otherwise the canvas would be torn down and rebuilt
  // on every keystroke.
  const frame = useRef({
    shown,
    document: grid,
    own: document,
    focused,
    currentGlyph,
    layout,
    selectionSet,
  });
  frame.current = {
    shown,
    document: grid,
    own: document,
    focused,
    currentGlyph,
    layout,
    selectionSet,
  };

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
      for (let i = range.first; i <= range.last; i++) {
        const entry = state.shown[i];
        const box = cellBox(layout, i);
        if (entry === undefined || box === null) continue;

        // Content coordinates to viewport coordinates. The canvas stays the size
        // of the viewport however tall the grid gets; only this offset moves.
        const cellGlyph = entry.drawn ? state.document.glyphs[entry.name] : undefined;
        const missing = !entry.inFont;
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
            focused: i === state.focused,
            current: !missing && entry.name === state.currentGlyph,
            selected: !missing && state.selectionSet.size > 1 && state.selectionSet.has(entry.name),
            markColor: missing ? null : (state.document.glyphs[entry.name]?.markColor ?? null),
            absent:
              !missing &&
              state.document !== state.own &&
              state.own.glyphs[entry.name] === undefined,
            missing,
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
  }, [shown, focused, currentGlyph, grid, layout, selectionSet]);

  // A filter that shortens the list must not strand focus past its end.
  useEffect(() => {
    setFocused((f) => Math.min(f, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  /**
   * The cell the pointer is resting on, and what the tip beside it says.
   *
   * A cell has room for a glyph name and a code point, and `uni0308` with
   * `U+0308` under it says the same thing twice while answering neither "which
   * mark is this" nor "what is it for". The tip is where the words go.
   *
   * Held by index and redrawn from the layout rather than followed with the
   * pointer: the tip belongs to a cell, and a tip that slides about while the
   * pointer moves inside one cell is harder to read than one that stays put.
   */
  const [hovered, setHovered] = useState<{ index: number; top: number; left: number } | null>(null);
  // Set once the table of Unicode names has been unpacked, which happens on the
  // first hover and never in a session that does not hover a cell: it is four
  // hundred kilobytes, and nothing else in the editor wants it.
  const [named, setNamed] = useState(false);
  useEffect(() => {
    if (hovered === null || named) return;
    let watching = true;
    void loadUnicodeNames().then(() => {
      if (watching) setNamed(true);
    });
    return () => {
      watching = false;
    };
  }, [hovered, named]);

  const hover = (event: { clientX: number; clientY: number }): void => {
    const scroller = scrollRef.current;
    const index = cellFromEvent(event, scroller, layout);
    const box = index === null ? null : cellBox(layout, index);
    if (index === null || box === null || scroller === null) {
      setHovered(null);
      return;
    }
    // Under the cell, or over it near the foot of the list, and never off the
    // left or right of the grid.
    const top = box.y - scroller.scrollTop;
    const below = top + box.height + 6;
    const room = scroller.clientHeight - below > 96;
    setHovered((was) =>
      was?.index === index
        ? was
        : {
            index,
            top: room ? below : Math.max(4, top - 96),
            left: Math.max(4, Math.min(box.x, scroller.clientWidth - 232)),
          },
    );
  };

  /** What the tip says about the cell under the pointer. */
  const tip = useMemo(() => {
    if (hovered === null) return null;
    const entry = shown[hovered.index];
    if (entry === undefined) return null;
    const code = entry.codePoint;
    return {
      name: entry.name,
      sample: sampleText(code),
      codePoint: code === null ? null : formatCodePoint(code),
      // `named` is read so that the tip is worked out again once the table is
      // there, rather than keeping the `null` from before it arrived.
      unicode: code === null || !named ? null : unicodeName(code),
      block: entry.block?.label ?? null,
      drawn: entry.drawn,
      inFont: entry.inFont,
    };
  }, [hovered, shown, named]);

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
    const name = inFont(index);
    setRenaming(null);
    if (name === null || to.trim() === "" || to.trim() === name) return;

    store.setCurrentGlyph(name);
    store.applyTool(renameCurrentGlyph(store.editor, to));
  };

  const startRename = (index: number): void => {
    const name = inFont(index);
    if (name === null || name === NOTDEF) return;
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
    // The copy on its own, so the next Delete is about it and not the original.
    setPicked(new Set([pendingRename]));
    setAnchor(index);
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

  /**
   * What the menu offers for one cell, and for the others picked with it.
   *
   * A cell that is one of the picked ones speaks for all of them; one that is
   * not speaks for itself, and has been picked alone by the time the menu
   * opens. Renaming and duplicating are about one glyph and are offered for one.
   */
  const cellItems = (index: number): Item[] => {
    const entry = shown[index];
    if (entry === undefined) return [];
    // What is on offer for a code point with no glyph: making it, with or
    // without opening it. Nothing else on this menu is about anything that
    // exists yet.
    if (!entry.inFont) {
      return [
        {
          kind: "item",
          label: "Add to font",
          icon: SquarePlusIcon,
          run: () => makeAt(index, false),
        },
        {
          kind: "item",
          label: "Add and open",
          icon: PenToolIcon,
          run: () => makeAt(index, true),
        },
      ];
    }
    const name = entry.name;
    const names = selectionSet.has(name) ? selection : [name];
    const several = names.length > 1;
    const marks = names.map((each) => document.glyphs[each]?.markColor ?? null);

    return [
      { kind: "item", label: "Open", icon: PenToolIcon, run: () => openAt(index) },
      {
        kind: "item",
        label: "Rename…",
        icon: TypeIcon,
        // `.notdef` is found by name when a font is written, so renaming it
        // loses the glyph rather than relabelling it.
        disabled: several || name === NOTDEF,
        run: () => startRename(index),
      },
      {
        kind: "item",
        label: "Duplicate",
        icon: CopyPlusIcon,
        // A second `.notdef` is a glyph no font is allowed.
        disabled: several || name === NOTDEF,
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
          if (!several) store.setCurrentGlyph(name);
          store.applyTool(roundGlyphsAt(store.editor, names));
        },
      },
      { kind: "separator" },
      // Between each glyph picked and a layer: the background whether or not the
      // font has one yet, since the first copy into it is how it is begun, and
      // every other layer the font has.
      ...layerTargets(document).flatMap((layer): Item[] => {
        const label = layerLabel(layer);
        const drawnIn = names.some((each) => grid.glyphs[each]?.layers[layer] !== undefined);
        return [
          {
            kind: "item",
            label: `Copy to ${label}`,
            icon: CopyIcon,
            run: () => store.copyToLayer(names, layer),
          },
          {
            kind: "item",
            label: `Swap with ${label}`,
            icon: ArrowLeftRightIcon,
            run: () => store.swapWithLayer(names, layer),
          },
          {
            kind: "item",
            label: `Clear ${label}`,
            disabled: !drawnIn,
            run: () => store.clearLayer(names, layer),
          },
        ];
      }),
      { kind: "separator" },
      // The colour marks, each drawn as itself and ticked when it is the one on
      // every glyph picked: a row of words would have to be read, and a mark is
      // recognised.
      ...MARK_COLORS.map((mark): Item => ({
        kind: "item",
        label: mark.name,
        icon: markSwatch(mark.value),
        checked: marks.every((each) => sameMarkColor(each, mark.value)),
        run: () => store.applyTool(setMarkColors(store.editor, names, mark.value)),
      })),
      {
        kind: "item",
        label: "No colour",
        disabled: marks.every((each) => each === null),
        run: () => store.applyTool(setMarkColors(store.editor, names, null)),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: several ? `Delete ${String(names.length)} glyphs` : "Delete",
        icon: TrashIcon,
        // Kept for the same reason it cannot be renamed: a font needs one, and
        // what the export would put back is a blank.
        disabled: names.every((each) => each === NOTDEF),
        run: () => store.applyTool(deleteGlyphs(store.editor, names)),
      },
    ];
  };

  const openAt = (index: number): void => {
    const entry = shown[index];
    if (entry === undefined) return;
    // A cell the font has nothing for: the gesture that opens a glyph makes
    // this one, which is what somebody looking at a hole in a block came to do.
    if (!entry.inFont) {
      makeAt(index, true);
      return;
    }
    // Not drawn in this master: asked rather than done, because opening it
    // means adding a glyph to a master that was deliberately drawn without it.
    if (absent(entry.name)) setOffer(entry.name);
    else onOpen(entry.name);
  };

  /**
   * Make the glyph a cell stands for.
   *
   * The advance a new glyph starts with is half the em, as it is everywhere
   * else a glyph is made: a width to be spaced rather than a drawing decision.
   * Opening it is what the double-click asked for; the menu can add one without
   * leaving the grid, which is how a row of them gets added.
   */
  const makeAt = (index: number, open: boolean): void => {
    const entry = shown[index];
    if (entry === undefined || entry.inFont || entry.codePoint === null) return;

    const advance = Math.round(document.info.unitsPerEm / 2);
    store.applyTool(
      createGlyphs(store.editor, [{ name: entry.name, unicodes: [entry.codePoint] }], advance),
    );
    if (open) onOpen(entry.name);
  };

  /**
   * Pick a cell, the way a file browser does: a click picks one, ctrl or command
   * adds one or takes it away, and shift takes the run from the last cell picked
   * on its own. The focus goes with it, so the keyboard carries on from there.
   */
  const pick = (
    index: number,
    how: { readonly toggle: boolean; readonly extend: boolean },
  ): void => {
    const entry = shown[index];
    if (entry === undefined) return;
    // A cell the font has nothing for takes the focus and nothing else: what is
    // picked is what the menu and Delete are about, and neither has anything to
    // say about a glyph that does not exist.
    if (!entry.inFont) {
      setPicked(new Set());
      setAnchor(index);
      setFocused(index);
      return;
    }
    const name = entry.name;

    if (how.extend) {
      const from = Math.min(anchor, index);
      const to = Math.max(anchor, index);
      setPicked(
        new Set(
          shown
            .slice(from, to + 1)
            .filter((each) => each.inFont)
            .map((each) => each.name),
        ),
      );
    } else if (how.toggle) {
      const next = new Set(selection);
      // The last one stays: picking nothing would leave the menu with nothing
      // to be about but the focus, which is the cell just taken away.
      if (next.has(name) && next.size > 1) next.delete(name);
      else next.add(name);
      setPicked(next);
      setAnchor(index);
    } else {
      setPicked(new Set([name]));
      setAnchor(index);
    }
    setFocused(index);
  };

  const moveFocus = (next: number, extend = false): void => {
    const clamped = Math.max(0, Math.min(shown.length - 1, next));
    pick(clamped, { toggle: false, extend });

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
            <Designspace />
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
              {shown.length - toMake === entries.length
                ? `${String(entries.length)} glyphs`
                : `${String(shown.length - toMake)} of ${String(entries.length)}`}
              {toMake > 0 ? ` · ${String(toMake)} not in the font` : ""}
              {selection.length > 1 ? ` · ${String(selection.length)} picked` : ""}
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
              // Every glyph shown. Kept from reaching the window, where the same
              // keys select every point of the open glyph.
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
                event.preventDefault();
                event.stopPropagation();
                setPicked(new Set(shown.filter((e) => e.inFont).map((e) => e.name)));
                return;
              }
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
                moveFocus(next, event.shiftKey);
                return;
              }
              if (event.key === "Escape") {
                setPicked(new Set());
                setAnchor(focused);
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
                if (selection.length > 0) store.applyTool(deleteGlyphs(store.editor, selection));
                setPicked(new Set());
              }
            }}
            onScroll={(event) => {
              if (renaming !== null) setRenameScroll(event.currentTarget.scrollTop);
              // The tip belongs beside its cell, and the cell has moved.
              setHovered(null);
            }}
            onPointerMove={(event) => {
              if (event.pointerType === "mouse") hover(event);
            }}
            onPointerLeave={() => setHovered(null)}
            onClick={(event) => {
              const index = cellFromEvent(event, scrollRef.current, layout);
              if (index !== null) {
                pick(index, { toggle: event.ctrlKey || event.metaKey, extend: event.shiftKey });
              }
            }}
            onDoubleClick={(event) => {
              const index = cellFromEvent(event, scrollRef.current, layout);
              if (index !== null) openAt(index);
            }}
            onContextMenu={(event) => {
              const index = cellFromEvent(event, scrollRef.current, layout);
              if (index === null) return;
              event.preventDefault();
              // Pointing outside the picked cells picks the one pointed at, so
              // the menu is never about glyphs other than the one under it.
              const name = inFont(index);
              if (name === null || !selectionSet.has(name)) {
                pick(index, { toggle: false, extend: false });
              } else {
                setFocused(index);
              }
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

          {/* What a cell cannot say in the room it has: the name the standard
              gives the character, the block it comes from, and whether the glyph
              has been drawn. Hidden while a menu or a rename field is open, both
              of which are about a cell the pointer may no longer be over. */}
          {tip === null || menu !== null || renaming !== null ? null : (
            <div
              className={styles.tip}
              role="tooltip"
              style={{
                top: `${String(hovered?.top ?? 0)}px`,
                left: `${String(hovered?.left ?? 0)}px`,
              }}
            >
              <div className={styles.tipHead}>
                {tip.sample === null ? null : (
                  <span className={styles.tipSample}>{tip.sample}</span>
                )}
                {/* The name a glyph would be given, said as a proposal rather
                    than as a fact, since the font has no glyph by that name. */}
                <b data-proposed={tip.inFont ? undefined : "true"}>{tip.name}</b>
                {tip.codePoint === null ? null : (
                  <span className={styles.tipCode}>{tip.codePoint}</span>
                )}
              </div>
              {tip.unicode === null ? null : <div className={styles.tipName}>{tip.unicode}</div>}
              <div className={styles.tipNote}>
                {tip.block ?? "Unencoded"}
                {/* Three things a cell can be, and the tip says which: in the
                    font and drawn, in the font and empty, or not there at all
                    and one keystroke from being made. */}
                {tip.inFont ? (tip.drawn ? "" : " · not yet drawn") : " · not in the font"}
              </div>
              {tip.inFont ? null : (
                <div className={styles.tipNote}>Press Enter, or double-click, to make it</div>
              )}
            </div>
          )}

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

        {offer === null || !absent(offer) ? null : (
          <div className={styles.offer} role="alertdialog" aria-label={`Draw ${offer} here`}>
            <span>
              {sparseName ?? "This master"} does not draw <b>{offer}</b>. Draw it here, starting
              from the shape the rest of the family has at this place?
            </span>
            <button
              type="button"
              className={styles.offerGo}
              autoFocus
              onClick={() => {
                const name = offer;
                setOffer(null);
                void store.drawHere(name).then(() => {
                  if (store.editor.document.glyphs[name] !== undefined) onOpen(name);
                });
              }}
            >
              Draw it here
            </button>
            <button type="button" className={styles.offerNo} onClick={() => setOffer(null)}>
              Not now
            </button>
          </div>
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

/** The layers the grid's menu offers: the background always, then the font's others. */
function layerTargets(document: FontDocument): string[] {
  return [BACKGROUND, ...document.layers.map((l) => l.name).filter((n) => n !== BACKGROUND)];
}

/**
 * The font as the grid shows it: the open master's own glyphs over the whole
 * master's, in the whole master's order. Just the open master where it is whole.
 */
function withWhole(own: FontDocument, whole: FontDocument | null): FontDocument {
  if (whole === null) return own;
  return {
    ...own,
    glyphOrder: [...whole.glyphOrder, ...own.glyphOrder.filter((n) => !(n in whole.glyphs))],
    glyphs: { ...whole.glyphs, ...own.glyphs },
  };
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
