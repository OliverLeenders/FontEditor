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
 * The files a static host needs beside the page, written into the build.
 *
 * Cloudflare Pages reads `_headers` and `_redirects` from the root of what is
 * published — Netlify reads the same two — so this is where the editor says how
 * it wants to be served rather than a setting typed into somebody's dashboard
 * and forgotten. Nothing else uses them: the desktop application gets its
 * policy from Tauri, and `vite preview` sends its own.
 *
 * The policy is the desktop one with the parts that only mean something inside
 * Tauri taken out, so the two cannot drift: there is one list of what the
 * editor is allowed to do, in `tauri.conf.json`, and each place it is served
 * from states it in its own words.
 */
function hostFiles(): Plugin {
  return {
    name: "typewright:host-files",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: headers() });
      // Everything to the page: the editor has no routes of its own, so this is
      // for a stray deep link rather than for navigation — and a 404 where a
      // font was expected is a worse answer than the editor.
      this.emitFile({
        type: "asset",
        fileName: "_redirects",
        source: "/*  /index.html  200\n",
      });
    },
  };
}

function headers(): string {
  const policy = webPolicy();
  return [
    "/*",
    `  Content-Security-Policy: ${policy}`,
    // A file served as the wrong type is a file a browser may run.
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: no-referrer",
    // The page itself is checked every time: it names the hashed files below,
    // and a stale one would go on naming last week's.
    "  Cache-Control: no-cache",
    "",
    // Everything under /assets carries a hash of its own contents in its name,
    // so it can be kept for as long as a browser likes: a new build is a new
    // name rather than a new version of the same one.
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n");
}

/** The desktop policy, minus what only a Tauri window can do. */
function webPolicy(): string {
  const config = JSON.parse(
    readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  ) as { app: { security: { csp: Record<string, string> } } };

  return Object.entries(config.app.security.csp)
    .map(([directive, sources]) => {
      if (directive !== "connect-src") return `${directive} ${sources}`;
      // `ipc:` and the local host Tauri answers on are how the window talks to
      // the shell. There is no shell here.
      const web = sources
        .split(/\s+/)
        .filter((source) => source !== "ipc:" && source !== "http://ipc.localhost")
        .join(" ");
      return `${directive} ${web}`;
    })
    .join("; ");
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

/**
 * The version, out of the manifest and into the built page.
 *
 * One number in one place: `set-version.mjs` writes the manifest, the Cargo
 * files and the tag together, and this carries the same string into the editor
 * so that what the About row says is what was released. Read at build time
 * rather than imported, since a JSON import would put the whole manifest in the
 * bundle to get one field out of it.
 */
function version(): string {
  const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return manifest.version;
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version()) },
  plugins: [react(), legalFiles(), hostFiles()],
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
