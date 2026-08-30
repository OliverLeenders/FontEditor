import { useEffect, useState } from "react";

import { GlyphCanvas } from "./components/GlyphCanvas.js";
import { GlyphStrip } from "./components/GlyphStrip.js";
import { Inspector } from "./components/Inspector.js";
import { StatusBar } from "./components/StatusBar.js";
import { TabBar, type ViewId } from "./components/TabBar.js";
import { Toolbar } from "./components/Toolbar.js";
import styles from "./App.module.css";
import { useEditorStore, useStoreValue } from "./useStore.js";

export function App(): JSX.Element {
  const store = useEditorStore();
  const [view, setView] = useState<ViewId>("glyph");
  const glyphName = useStoreValue((s) => s.session.editor.currentGlyph);
  const inspectorOpen = useStoreValue((s) => s.inspector.open);

  // Application shortcuts live on the window; the tools' own keys are handled by
  // the canvas, which only receives them while it has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const typing = event.target instanceof HTMLInputElement;

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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        store.redo();
        return;
      }
      if (!typing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "i") {
        store.toggleInspector();
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
      <TabBar current={view} onSelect={setView} glyphName={glyphName} />
      <Toolbar />
      <main className={styles.stage}>
        <GlyphCanvas />
        <Inspector />
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
      <StatusBar />
    </div>
  );
}
