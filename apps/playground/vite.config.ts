import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // The workspace packages resolve straight to TypeScript source, so there is
    // no build step to wait on and an edit in `geometry` shows up in the browser
    // immediately. Excluding them from pre-bundling is what keeps that true —
    // otherwise esbuild snapshots them once at startup and later edits are
    // silently ignored until the server restarts.
    exclude: [
      "@fonteditor/geometry",
      "@fonteditor/font-model",
      "@fonteditor/view",
      "@fonteditor/render",
      "@fonteditor/tools",
    ],
  },
});
