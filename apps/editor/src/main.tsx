import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { EditorStore } from "./store.js";
import { StoreProvider } from "./useStore.js";
import "./styles/tokens.css";

const root = document.getElementById("root");
if (root === null) throw new Error("The page has no #root to mount into.");

const store = new EditorStore();

createRoot(root).render(
  <StrictMode>
    <StoreProvider value={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
);
