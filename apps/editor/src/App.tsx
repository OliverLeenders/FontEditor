import { canOpenFolders } from "@typewright/disk";
import { randomIds } from "@typewright/font-model";
import {
  clipboardText,
  deleteSelectedContours,
  pasteContours,
  selectAllPoints,
} from "@typewright/tools";
import { useEffect, useRef, useState, useCallback } from "react";

import { applyTheme } from "./scheme.js";
import { looksLikeSvg } from "./svgImport.js";

import { ContextMenu, type MenuRequest } from "./components/ContextMenu.js";
import { Divider } from "./components/Divider.js";
import { GlyphBrowser } from "./components/GlyphBrowser.js";
import { GlyphCanvas } from "./components/GlyphCanvas.js";
import { GlyphStrip } from "./components/GlyphStrip.js";
import { Inspector } from "./components/Inspector.js";
import { FeaturesView } from "./components/FeaturesView.js";
import { ProofView } from "./components/ProofView.js";
import { Opening } from "./components/Opening.js";
import { Projects } from "./components/Projects.js";
import { CloseWarning } from "./components/CloseWarning.js";
import { UpdateNotice } from "./components/UpdateNotice.js";
import { desktop } from "./desktop.js";
import { SpacingView } from "./components/SpacingView.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { Shortcuts } from "./components/Shortcuts.js";
import { StatusBar } from "./components/StatusBar.js";
import { TabBar, type ViewId } from "./components/TabBar.js";
import { Toolbar } from "./components/Toolbar.js";
import { WindowBar } from "./components/WindowBar.js";
import styles from "./App.module.css";
import {
  type PaneIndex,
  type Panes,
  SINGLE_PANE,
  activeView,
  choosePane,
  closeSecondPane,
  focusPane,
  openGlyphBeside,
  openGlyphFrom,
  openSecondPane,
  panelPane,
  viewIn,
} from "./layout.js";
import { keyTarget } from "./keyTarget.js";
import { PaneContext } from "./pane.js";
import { useEditorStore, useStoreValue } from "./useStore.js";
import { openWindow } from "./windows.js";

/** Pasted contours need ids; the application owns the factory. */
const pasteIds = randomIds();

export function App(): React.JSX.Element {
  const store = useEditorStore();
  // The font is where a session starts: the whole typeface, and the glyph you
  // want to work on somewhere in it. Opening on the canvas meant opening on
  // whichever letter happened to be first, which is an answer to a question
  // nobody asked yet.
  //
  // One pane or two. Which workspaces they show is where somebody is rather
  // than a setting, so it is not remembered; the shape of the split is.
  const [panes, setPanes] = useState<Panes>(SINGLE_PANE);
  // The menu, and which pane it was opened in: two panes may both be drawing,
  // and a menu belongs to the canvas it was asked for on.
  const [menu, setMenu] = useState<(MenuRequest & { pane: PaneIndex }) | null>(null);
  const [keysShown, setKeysShown] = useState(false);
  const [paletteShown, setPaletteShown] = useState(false);
  const [historyShown, setHistoryShown] = useState(false);
  // The workspace the keyboard is in: the only one, or the active one of two.
  const view = activeView(panes);
  // Read by the window key handler, which is installed once and must not be
  // rebuilt every time the workspace changes.
  const viewRef = useRef(view);
  viewRef.current = view;
  // Which pane the keys that change a canvas — H and S — are about: the one
  // being drawn in, which is where the inspector is. Read by the same handler,
  // so it is a ref for the same reason.
  const drawingRef = useRef(panelPane(panes) ?? 0);
  drawingRef.current = panelPane(panes) ?? 0;
  const split = useStoreValue((s) => s.split);
  const glyphName = useStoreValue((s) => s.session.editor.currentGlyph);
  const inspectorOpen = useStoreValue((s) => s.inspector.open);
  const dock = useStoreValue((s) => s.inspector.dock);
  const ownership = useStoreValue((s) => s.ownership);
  const theme = useStoreValue((s) => s.theme);
  const showChooser = useStoreValue((s) => s.projects.showing);
  const arriving = useStoreValue((s) => s.projects.arriving);

  // Read once, on the way in, but from a ref: the effect that asks must not be
  // re-run because the reader later changed their mind about being asked.
  const skipChooser = useStoreValue((s) => s.skipChooser);
  const skipRef = useRef(skipChooser);
  skipRef.current = skipChooser;

  // The document carries the choice, and the canvases read it back through
  // `isDarkNow`. Done here rather than in the store so the store stays free of
  // the DOM, which is what lets it be built and driven in a test.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // The window says which font it is on, so two windows can be told apart in
  // the taskbar and two tabs in the tab strip. The desktop window's title is
  // its own rather than the page's, so it is told as well.
  const family = useStoreValue((s) => s.session.editor.document.info.familyName);
  const style = useStoreValue((s) => s.session.editor.document.info.styleName);
  useEffect(() => {
    const name = `${family} ${style}`.trim();
    const title = showChooser || arriving || name === "" ? "Typewright" : `${name} — Typewright`;
    document.title = title;
    void desktop()
      ?.invoke("set_title", { title })
      .catch(() => {
        // A window that cannot be renamed still works; nothing depends on it.
      });
  }, [family, style, showChooser, arriving]);

  // Application shortcuts live on the window; the tools' own keys are handled by
  // the canvas, which only receives them while it has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A textarea is typed in too — the proof's text and the feature file are
      // both one, and leaving them out took their "?" for the list of keys.
      const { typing, ownUndo, onControl } = keyTarget(event.target);

      // Undo is not a drawing shortcut. Every workspace that edits the document
      // needs it, and gating it on the glyph view left spacing edits with no way
      // back — which is worse than an unhandled key, because the edit still
      // happened.
      // The list of keys is itself a key, and it is the one shortcut that has
      // to work from anywhere: somebody pressing it does not know where they
      // are. "?" is where every application keeps it; F1 is where the operating
      // system does.
      if (!typing && (event.key === "?" || event.key === "F1")) {
        event.preventDefault();
        setKeysShown((shown) => !shown);
        return;
      }

      const modified = event.ctrlKey || event.metaKey;
      // Every command by name, from anywhere: the one key that finds the rest.
      if (modified && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteShown((shown) => !shown);
        return;
      }
      // The undo history, from anywhere: it is the font's, not a pane's.
      if (modified && event.shiftKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
        setHistoryShown((shown) => !shown);
        return;
      }
      if (
        modified &&
        ownUndo &&
        (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
      ) {
        return;
      }
      if (modified && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (modified && event.key.toLowerCase() === "y") {
        event.preventDefault();
        store.redo();
        return;
      }

      // Saving is not a drawing shortcut either. This used to live in the File
      // menu's own component, which is mounted only in the font view — so
      // Ctrl-S did nothing in the four workspaces where most of the work
      // happens, including the one for drawing. What the save has to say for
      // itself is on the status bar, which is on screen wherever the shortcut
      // now is.
      // Another window, on the list of fonts: the way to a second font beside
      // this one. Only the desktop application ever sees the key.
      if (modified && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openWindow("fonts");
        return;
      }

      if (modified && event.key.toLowerCase() === "s") {
        // Saving the page is never what somebody wants from a font editor.
        event.preventDefault();
        if (!canOpenFolders() || !store.canSaveToFolder) return;
        // What went wrong is in the store, where the File menu says it.
        void store.saveToFolder().catch(() => undefined);
        return;
      }

      // The proof's waterfall back to its own sizes, as the drawing's Ctrl-0
      // fits the glyph: the undoing of what Ctrl and the wheel did there.
      if (modified && event.key === "0" && viewRef.current === "proof") {
        event.preventDefault();
        store.setProofZoom(1);
        return;
      }

      // The rest belong to the drawing canvas and mean nothing elsewhere.
      if (viewRef.current !== "glyph") return;

      if (modified && !typing && event.key.toLowerCase() === "a") {
        event.preventDefault();
        store.applyTool(selectAllPoints(store.editor));
        return;
      }

      // Through the font, a glyph at a time. The order is the font's own, which
      // is the order the browser shows and the order a UFO stores.
      if (!typing && !modified && (event.key === "PageUp" || event.key === "PageDown")) {
        event.preventDefault();
        store.stepGlyph(event.key === "PageDown" ? 1 : -1);
        return;
      }

      if (event.code === "Space" && !typing && !onControl) {
        event.preventDefault();
        store.setPreviewing(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        event.preventDefault();
        store.fitGlyph();
        return;
      }
      if (!typing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "i") {
        store.toggleInspector();
        return;
      }
      // Lower case only, and not while a tool key could mean something else —
      // "H" is free, where the tool letters are not.
      if (!typing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "h") {
        store.toggleAutoHideHandles(drawingRef.current);
        return;
      }
      // "S" is free too. The tool letters are V P K R E M, and "R" also reverses
      // a contour inside the select tool.
      if (!typing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "s") {
        store.toggleSnapPoints(drawingRef.current);
        return;
      }
      // "G" shows the font's grid, which drags snap to whether or not it is shown;
      // with shift, the keylines an icon is drawn inside.
      if (!typing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "g") {
        if (event.shiftKey) store.toggleKeylines(drawingRef.current);
        else store.toggleGrid(drawingRef.current);
        return;
      }
      // "B" draws in the background, and again draws in the letter. Adding the
      // background layer the first time, as an undoable step of its own.
      if (!typing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "b") {
        store.toggleBackground();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space") store.setPreviewing(false);
    };
    // A key let go of in another window is never heard here: Space held while
    // switching away left the preview on until Space was pressed again.
    const onBlur = (): void => store.setPreviewing(false);
    /**
     * On the way out: settle the working copy, and speak up about the folder.
     *
     * Two different things, and only one of them is a warning. The working copy
     * has everything and is flushed without asking. What the folder on disk
     * does not have is worth stopping for — and it is the *folder* that is
     * behind, not the work, which is why nothing here says anything about
     * losing changes.
     */
    const onUnload = (event: BeforeUnloadEvent): void => {
      store.flush();
      // The browser shows its own words, not ours; all this does is ask for the
      // question to be asked at all.
      // In the desktop window the question is asked by `CloseWarning` instead,
      // with the three answers this dialog cannot offer.
      // And a font opened a moment ago and still being written: the flush
      // above is the edits, which is all a closing page has time for.
      if ((store.unsavedOnDisk || store.writingWholeFont) && desktop() === null) {
        event.preventDefault();
      }
    };
    const onResize = (): void => store.reclampInspector();
    // Whatever was begun and left, and failed with nobody waiting for it. Not
    // prevented: the console still has it, with where it came from.
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      store.reportFailure(event.reason);
    };
    // And what was thrown there and then, by a click or a key: the same thing
    // not having happened, with the same nobody told. Only what was thrown as
    // an error — the browser says other things here that are not failures of
    // anything asked for, a script it will not describe or an observer that
    // ran out of frame.
    const onError = (event: ErrorEvent): void => {
      if (event.error instanceof Error) store.reportFailure(event.error);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("resize", onResize);
    };
  }, [store]);

  /**
   * Cut, copy and paste through the browser's own clipboard events.
   *
   * Listening for `copy`/`cut`/`paste` rather than reading the clipboard
   * directly: the events carry the data with them, so nothing has to ask for
   * clipboard permission, and Ctrl-C, Cmd-X and the Edit menu all arrive here
   * without shortcuts of our own to keep in step with the platform.
   *
   * A text field gets to keep its own clipboard. Someone editing the glyph name
   * or the spacing string means the text, not the outline.
   */
  useEffect(() => {
    const typingIn = (target: EventTarget | null): boolean => keyTarget(target).typing;

    const onCopy = (event: ClipboardEvent): void => {
      if (typingIn(event.target) || viewRef.current !== "glyph") return;
      const text = clipboardText(store.editor);
      if (text === null) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
    };

    const onCut = (event: ClipboardEvent): void => {
      if (typingIn(event.target) || viewRef.current !== "glyph") return;
      const text = clipboardText(store.editor);
      if (text === null) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
      store.applyTool(deleteSelectedContours(store.editor));
    };

    const onPaste = (event: ClipboardEvent): void => {
      if (typingIn(event.target) || viewRef.current !== "glyph") return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text === "") return;
      // A drawing copied out of another program arrives as SVG text, and its
      // shapes go into the glyph as a paste of this editor's own contours does.
      if (looksLikeSvg(text) && store.placeSvg(text)) {
        event.preventDefault();
        return;
      }
      // Not prevented unless it is ours, so pasting something else into the
      // canvas does nothing rather than swallowing the event.
      const result = pasteContours(store.editor, text, pasteIds);
      if (result.state === store.editor) return;
      event.preventDefault();
      store.applyTool(result);
    };

    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCut);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCut);
      window.removeEventListener("paste", onPaste);
    };
  }, [store]);

  /**
   * The first moment: which font, and then that font.
   *
   * The question is asked before storage is opened, which is what makes it
   * free — nothing has been loaded and no lock has been taken, so any of them
   * costs what the first one costs. A reader with one font is never asked.
   */
  useEffect(() => {
    const worker = new Worker(new URL("./storage.worker.ts", import.meta.url), { type: "module" });
    // An object rather than a captured `let`, so that what the cleanup does to
    // it is visible to everything reading it.
    const running = { yes: true };

    void (async () => {
      const arrival = await store.decideArrival(skipRef.current);
      if (!running.yes) return;

      // Copies left by fonts forgotten while another window had them open. Not
      // awaited: nothing on screen waits for it.
      void store.sweepForgotten().catch(() => undefined);

      if (arrival.kind === "choose") {
        // The worker goes with the list: a font file or a folder opened from it
        // is opened in this page, and opens the store as it does.
        store.offerProjects(arrival.all, worker);
        return;
      }

      // Not guarded again. Noting which font is open is a write to the store
      // and to the list of projects, and both are true whether or not this
      // component is still on screen.
      await store.arriveAt(worker, arrival.id);
    })();

    return () => {
      running.yes = false;
      worker.terminate();
    };
  }, [store]);

  /** A workspace in the pane the keyboard is in, as the command palette asks for one. */
  const goToWorkspace = useCallback((id: ViewId): void => {
    setPanes((current) => choosePane(current, current.active, id));
  }, []);

  /** A glyph opened from the command palette, drawn as one chosen in the pane with the keyboard. */
  const openGlyphFromPalette = useCallback(
    (name: string): void => {
      store.setCurrentGlyph(name);
      setPanes((current) => openGlyphFrom(current, current.active));
    },
    [store],
  );

  /**
   * A glyph a step of the undo history changed, opened so what the step did is
   * on screen: drawn where the keyboard is when that pane draws or lists the
   * glyphs, and otherwise only made the current glyph — the spacing line and the
   * proof mark it, and turning them into a drawing would lose the place.
   */
  const openGlyphFromHistory = useCallback(
    (name: string): void => {
      store.setCurrentGlyph(name);
      setPanes((current) => {
        const shown = viewIn(current, current.active);
        return shown === "glyph" || shown === "font"
          ? openGlyphFrom(current, current.active)
          : current;
      });
    },
    [store],
  );

  /** What a workspace shows, in whichever pane it is. */
  const workspace = (shown: ViewId, index: PaneIndex): React.JSX.Element => {
    // A glyph chosen here is drawn in the other pane if that one is drawing,
    // and otherwise this pane turns to the drawing.
    const open = (name: string): void => {
      store.setCurrentGlyph(name);
      setPanes((current) => openGlyphFrom(current, index));
    };

    switch (shown) {
      case "features":
        return (
          <div className={styles.stage}>
            <FeaturesView
              onOpenGlyph={(name) => {
                // Drawn beside the source when the window is split, so the
                // file stays in sight while the glyph is looked at.
                store.setCurrentGlyph(name);
                setPanes((current) => openGlyphBeside(current, index));
              }}
            />
          </div>
        );
      case "proof":
        return (
          <div className={styles.stage}>
            <ProofView />
          </div>
        );
      case "spacing":
        return (
          <div className={styles.stage}>
            <SpacingView onOpenGlyph={open} />
          </div>
        );
      case "font":
        return (
          <div className={styles.stage}>
            <GlyphBrowser onOpen={open} />
          </div>
        );
      case "glyph": {
        // One inspector and one strip however many panes are drawing: both are
        // about the glyph rather than about a view of it.
        const panels = panelPane(panes) === index;
        return (
          <>
            <Toolbar />
            <div
              className={`${styles.stage} ${styles.editing}`}
              data-dock={dock === "float" ? undefined : dock}
            >
              {/* The canvas in a box of its own, so a docked inspector sits
                  beside it rather than over it and the drawing gets the rest. */}
              <div className={styles.drawing}>
                <GlyphCanvas onContextMenu={(request) => setMenu({ ...request, pane: index })} />
                {menu !== null && menu.pane === index ? (
                  <ContextMenu store={store} request={menu} onClose={() => setMenu(null)} />
                ) : null}
                {panels && !inspectorOpen ? (
                  <button
                    type="button"
                    className={styles.reveal}
                    title="Show the inspector  (I)"
                    onClick={() => store.toggleInspector()}
                  >
                    Inspector
                  </button>
                ) : null}
              </div>
              {panels ? <Inspector /> : null}
            </div>
            {panels ? <GlyphStrip /> : null}
          </>
        );
      }
    }
  };

  /**
   * One pane: its bar of workspaces, and the workspace.
   *
   * Pressing anywhere in a pane, or tabbing into it, makes it the one the
   * keyboard follows. Its share of the window is the divider's.
   */
  const pane = (index: PaneIndex): React.JSX.Element | null => {
    const shown = viewIn(panes, index);
    if (shown === null) return null;
    const two = panes.second !== null;
    const focus = (): void => setPanes((current) => focusPane(current, index));

    return (
      <PaneContext.Provider key={index} value={index}>
        <section
          className={styles.pane}
          data-pane={index}
          style={two ? { flexGrow: index === 0 ? split.ratio : 1 - split.ratio } : undefined}
          onPointerDownCapture={focus}
          onFocusCapture={focus}
        >
          <TabBar
            current={shown}
            onSelect={(id) => setPanes((current) => choosePane(current, index, id))}
            glyphName={glyphName}
            label={
              !two
                ? "Workspaces"
                : index === 0
                  ? "Workspaces in the first pane"
                  : "Workspaces in the second pane"
            }
            active={two && panes.active === index}
            orientation={split.orientation}
            onSplit={two ? undefined : () => setPanes(openSecondPane)}
            onFlip={
              two && index === 1
                ? () =>
                    store.placeSplit({
                      orientation: split.orientation === "row" ? "column" : "row",
                    })
                : undefined
            }
            onClose={two && index === 1 ? () => setPanes(closeSecondPane) : undefined}
          />
          {workspace(shown, index)}
        </section>
      </PaneContext.Provider>
    );
  };

  return (
    <div className={styles.shell}>
      {ownership === "reading" ? (
        <div className={styles.readOnly} role="status">
          <span>
            This font is open in another tab, which is the one saving. Nothing you change here will
            be kept.
          </span>
          <button type="button" onClick={() => void store.takeOver()}>
            Edit here instead
          </button>
        </div>
      ) : null}
      <WindowBar
        historyOpen={historyShown}
        onHistory={setHistoryShown}
        onOpenGlyph={openGlyphFromHistory}
      />
      <UpdateNotice />
      <CloseWarning />
      {showChooser ? (
        <Projects />
      ) : arriving ? (
        // Blank until there is something true to show: the list, or the font.
        <div className={styles.arriving} aria-busy="true" />
      ) : null}
      {/* Over either of them, and over the editor: a font being read. */}
      <Opening />
      <main
        className={styles.panes}
        data-orientation={panes.second === null ? undefined : split.orientation}
      >
        {pane(0)}
        {panes.second === null ? null : (
          <Divider
            orientation={split.orientation}
            ratio={split.ratio}
            onRatio={(ratio) => store.placeSplit({ ratio })}
          />
        )}
        {pane(1)}
      </main>
      <StatusBar workspace={view} onShortcuts={() => setKeysShown(true)} />
      {keysShown ? <Shortcuts onClose={() => setKeysShown(false)} /> : null}
      {paletteShown ? (
        <CommandPalette
          workspace={view}
          onWorkspace={goToWorkspace}
          onOpenGlyph={openGlyphFromPalette}
          onShowHistory={() => setHistoryShown(true)}
          onClose={() => setPaletteShown(false)}
        />
      ) : null}
    </div>
  );
}
