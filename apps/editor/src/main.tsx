import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { applyTheme } from "./scheme.js";
import { EditorStore } from "./store.js";
import { StoreProvider } from "./useStore.js";
import "./styles/tokens.css";

const root = document.getElementById("root");
if (root === null) throw new Error("The page has no #root to mount into.");

const store = new EditorStore();

// Before the first render rather than in an effect after it: a theme applied on
// mount is a frame of the wrong palette, and the frame it is wrong for is the
// one someone watches the editor open with.
applyTheme(store.getState().theme);

createRoot(root).render(
  <StrictMode>
    <StoreProvider value={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
);
