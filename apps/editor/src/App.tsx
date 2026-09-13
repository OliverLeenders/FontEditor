import { canOpenFolders } from "@typewright/disk";
import { randomIds } from "@typewright/font-model";
import {
  clipboardText,
  deleteSelectedContours,
  pasteContours,
  selectAllPoints,
} from "@typewright/tools";
import { useEffect, useRef, useState } from "react";

import { applyTheme } from "./scheme.js";

import { ContextMenu, type MenuRequest } from "./components/ContextMenu.js";
import { GlyphBrowser } from "./components/GlyphBrowser.js";
import { GlyphCanvas } from "./components/GlyphCanvas.js";
import { GlyphStrip } from "./components/GlyphStrip.js";
import { Inspector } from "./components/Inspector.js";
import { FeaturesView } from "./components/FeaturesView.js";
import { ProofView } from "./components/ProofView.js";
import { Projects } from "./components/Projects.js";
import { CloseWarning } from "./components/CloseWarning.js";
import { desktop } from "./desktop.js";
import { SpacingView } from "./components/SpacingView.js";
import { Shortcuts } from "./components/Shortcuts.js";
import { StatusBar } from "./components/StatusBar.js";
import { TabBar, type ViewId } from "./components/TabBar.js";
import { Toolbar } from "./components/Toolbar.js";
import styles from "./App.module.css";
import { useEditorStore, useStoreValue } from "./useStore.js";

/** Pasted contours need ids; the application owns the factory. */
const pasteIds = randomIds();

export function App(): React.JSX.Element {
  const store = useEditorStore();
  // The font is where a session starts: the whole typeface, and the glyph you
  // want to work on somewhere in it. Opening on the canvas meant opening on
  // whichever letter happened to be first, which is an answer to a question
  // nobody asked yet.
  const [view, setView] = useState<ViewId>("font");
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [keysShown, setKeysShown] = useState(false);
  // Read by the window key handler, which is installed once and must not be
  // rebuilt every time the workspace changes.
  const viewRef = useRef(view);
  viewRef.current = view;
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

  // Application shortcuts live on the window; the tools' own keys are handled by
  // the canvas, which only receives them while it has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const typing =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;

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
      if (modified && event.key.toLowerCase() === "s") {
        // Saving the page is never what somebody wants from a font editor.
        event.preventDefault();
        if (!canOpenFolders() || !store.canSaveToFolder) return;
        void store.saveToFolder();
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

      if (event.code === "Space" && !typing) {
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
        store.toggleAutoHideHandles();
        return;
      }
      // "S" is free too. The tool letters are V P K R E M, and "R" also reverses
      // a contour inside the select tool.
      if (!typing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "s") {
        store.toggleSnapPoints();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space") store.setPreviewing(false);
    };
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
      if (store.unsavedOnDisk && desktop() === null) event.preventDefault();
    };
    const onResize = (): void => store.reclampInspector();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
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
    const typingIn = (target: EventTarget | null): boolean =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;

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
      void store.sweepForgotten();

      if (arrival.kind === "choose") {
        store.offerProjects(arrival.all);
        return;
      }

      await store.connectStorage(worker, arrival.id);
      // Not guarded again. Noting which font is open is a write to the store
      // and to the list of projects, and both are true whether or not this
      // component is still on screen.
      await store.noteProjects(arrival.id);
    })();

    return () => {
      running.yes = false;
      worker.terminate();
    };
  }, [store]);

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
      <CloseWarning />
      {showChooser ? (
        <Projects />
      ) : arriving ? (
        // Blank until there is something true to show: the list, or the font.
        <div className={styles.arriving} aria-busy="true" />
      ) : null}
      <TabBar current={view} onSelect={setView} glyphName={glyphName} />
      {view === "features" ? (
        <main className={styles.stage}>
          <FeaturesView />
        </main>
      ) : view === "proof" ? (
        <main className={styles.stage}>
          <ProofView />
        </main>
      ) : view === "spacing" ? (
        <main className={styles.stage}>
          <SpacingView
            onOpenGlyph={(name) => {
              store.setCurrentGlyph(name);
              setView("glyph");
            }}
          />
        </main>
      ) : view === "font" ? (
        <main className={styles.stage}>
          <GlyphBrowser
            onOpen={(name) => {
              store.setCurrentGlyph(name);
              setView("glyph");
            }}
          />
        </main>
      ) : (
        <>
          <Toolbar />
          <main
            className={`${styles.stage} ${styles.editing}`}
            data-dock={dock === "float" ? undefined : dock}
          >
            {/* The canvas in a box of its own, so a docked inspector sits
                beside it rather than over it and the drawing gets the rest. */}
            <div className={styles.drawing}>
              <GlyphCanvas onContextMenu={setMenu} />
              {menu !== null ? (
                <ContextMenu store={store} request={menu} onClose={() => setMenu(null)} />
              ) : null}
              {!inspectorOpen ? (
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
            <Inspector />
          </main>
          <GlyphStrip />
        </>
      )}
      <StatusBar workspace={view} onShortcuts={() => setKeysShown(true)} />
      {keysShown ? <Shortcuts onClose={() => setKeysShown(false)} /> : null}
    </div>
  );
}
