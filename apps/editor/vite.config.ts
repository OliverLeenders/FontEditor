import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The licence and the third-party notices, beside `index.html` in the build.
 *
 * The bundle drops the comments a library's copyright notice lived in, so the
 * notices file is where those licences' conditions are met — for anyone the
 * editor is served to, and in the desktop app, which embeds this directory.
 */
function legalFiles(): Plugin {
  const files = {
    "LICENSE.txt": "../../LICENSE",
    "THIRD_PARTY_NOTICES.txt": "../../THIRD_PARTY_NOTICES.txt",
  };
  return {
    name: "typewright:legal-files",
    apply: "build",
    generateBundle() {
      for (const [fileName, from] of Object.entries(files)) {
        this.emitFile({
          type: "asset",
          fileName,
          source: readFileSync(new URL(from, import.meta.url)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), legalFiles()],
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
      "@typewright/geometry",
      "@typewright/font-model",
      "@typewright/view",
      "@typewright/render",
      "@typewright/tools",
      "@typewright/edit-core",
      "@typewright/storage",
      "@typewright/shaping",
      // HarfBuzz finds its WebAssembly beside its own script, through
      // `import.meta.url`. Pre-bundled into Vite's dependency cache, the script
      // moves and the file it looks for is no longer next to it.
      "harfbuzzjs",
    ],
  },
});
