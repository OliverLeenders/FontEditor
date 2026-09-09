import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Fail rather than pick another port. The desktop shell is told to load
    // 5174 and nothing else, so a dev server that quietly moved to 5175 would
    // leave the window pointing at whatever was on 5174 — which, if another
    // copy of the editor is already running, is the wrong one.
    strictPort: true,
    watch: {
      // Never look inside the desktop shell. `src-tauri/target` is cargo's
      // scratch space — thousands of files, written while the Rust compiler is
      // running, some of them locked as it writes them — and a watcher that
      // tries to follow one goes down with EBUSY and takes the dev server with
      // it. Nothing in there is source the browser could reload anyway.
      ignored: ["**/src-tauri/**"],
    },
  },
  // The desktop shell prints its own progress, and Vite clearing the screen
  // takes the Rust compiler's output with it.
  clearScreen: false,
  optimizeDeps: {
    // Workspace packages resolve to TypeScript source, so an edit in `geometry`
    // reaches the browser without a build step. Pre-bundling would snapshot them
    // once at startup and silently ignore later edits.
    exclude: [
      "@fonteditor/geometry",
      "@fonteditor/font-model",
      "@fonteditor/view",
      "@fonteditor/render",
      "@fonteditor/tools",
      "@fonteditor/edit-core",
      "@fonteditor/storage",
    ],
  },
});
