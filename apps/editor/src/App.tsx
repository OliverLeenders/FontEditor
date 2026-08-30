import { useEffect, useRef, useState } from "react";

import { ContextMenu, type MenuRequest } from "./components/ContextMenu.js";
import { GlyphBrowser } from "./components/GlyphBrowser.js";
import { GlyphCanvas } from "./components/GlyphCanvas.js";
import { GlyphStrip } from "./components/GlyphStrip.js";
import { Inspector } from "./components/Inspector.js";
import { SpacingView } from "./components/SpacingView.js";
import { StatusBar } from "./components/StatusBar.js";
import { TabBar, type ViewId } from "./components/TabBar.js";
import { Toolbar } from "./components/Toolbar.js";
import styles from "./App.module.css";
import { useEditorStore, useStoreValue } from "./useStore.js";

export function App(): JSX.Element {
  const store = useEditorStore();
  const [view, setView] = useState<ViewId>("glyph");
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  // Read by the window key handler, which is installed once and must not be
  // rebuilt every time the workspace changes.
  const viewRef = useRef(view);
  viewRef.current = view;
  const glyphName = useStoreValue((s) => s.session.editor.currentGlyph);
  const inspectorOpen = useStoreValue((s) => s.inspector.open);
  const ownership = useStoreValue((s) => s.ownership);

  // Application shortcuts live on the window; the tools' own keys are handled by
  // the canvas, which only receives them while it has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const typing =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement;

      // Undo is not a drawing shortcut. Every workspace that edits the document
      // needs it, and gating it on the glyph view left spacing edits with no way
      // back — which is worse than an unhandled key, because the edit still
      // happened.
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

      // The rest belong to the drawing canvas and mean nothing elsewhere.
      if (viewRef.current !== "glyph") return;

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
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space") store.setPreviewing(false);
    };
    const onUnload = (): void => store.flush();
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

  useEffect(() => {
    const worker = new Worker(new URL("./storage.worker.ts", import.meta.url), { type: "module" });
    void store.connectStorage(worker);
    return () => worker.terminate();
  }, [store]);

  return (
    <div className={styles.shell}>
      {ownership === "reading" ? (
        <div className={styles.readOnly} role="status">
          <span>
            This font is open in another tab, which is the one saving. Nothing you
            change here will be kept.
          </span>
          <button type="button" onClick={() => void store.takeOver()}>
            Edit here instead
          </button>
        </div>
      ) : null}
      <TabBar current={view} onSelect={setView} glyphName={glyphName} />
      {view === "spacing" ? (
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
          <main className={styles.stage}>
            <GlyphCanvas onContextMenu={setMenu} />
            <Inspector />
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
          </main>
          <GlyphStrip />
        </>
      )}
      <StatusBar workspace={view === "glyph" ? "glyph" : "font"} />
    </div>
  );
}
