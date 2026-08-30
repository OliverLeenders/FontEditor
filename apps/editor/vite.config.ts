import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
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
