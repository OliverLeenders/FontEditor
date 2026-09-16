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

/**
 * The desktop window's content security policy, as a header.
 *
 * `tauri.conf.json` holds it, and Tauri sends it with every page of the built
 * application. `vite preview` sends the same header, so the built editor can be
 * tried under the policy in an ordinary browser, whose devtools say what it
 * refused and why. The development server sends none, as the desktop app's
 * development window gets none: Tauri only attaches the policy to files it
 * serves itself.
 */
function desktopPolicy(): string {
  const config = JSON.parse(
    readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  ) as { app: { security: { csp: Record<string, string> } } };
  return Object.entries(config.app.security.csp)
    .map(([directive, sources]) => `${directive} ${sources}`)
    .join("; ");
}

export default defineConfig({
  plugins: [react(), legalFiles()],
  build: {
    /*
     * React in a chunk of its own.
     *
     * Not to make the download smaller — it is the same bytes either way — but
     * to keep them cached. React changes when React is upgraded, which is
     * rarely; the editor changes every release, and a reader who has the one
     * should not fetch the other again to get it.
     */
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [{ name: "react", test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/ }],
        },
      },
    },
    /*
     * Above the largest chunk anybody meant to ship.
     *
     * That is HarfBuzz's own build at about a megabyte, which is downloaded
     * only when text is first set — see `@typewright/shaping` — and the editor's
     * own startup chunk is a third of it. The default of 500 kB warns about
     * both on every build, and a warning nobody can act on is a warning nobody
     * reads; this one goes off when something unexpected arrives instead.
     */
    chunkSizeWarningLimit: 1100,
  },
  preview: {
    // Not 5174: a preview is the built editor, and should never be mistaken for
    // — or take the storage of — the development server's.
    port: 4173,
    strictPort: true,
    headers: { "Content-Security-Policy": desktopPolicy() },
  },
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
