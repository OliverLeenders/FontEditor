import { defineConfig } from "vitest/config";

import Durations from "../../tools/durations/reporter.mjs";

/**
 * The tests that drive the desktop application itself: its windows, closing
 * one, and the programs it runs that a browser cannot.
 *
 * Not part of `pnpm test`: they want a test build of the shell, tauri-driver,
 * and on Windows an msedgedriver to match the WebView2 — see
 * `desktop/harness.ts`. `pnpm test:desktop` builds and runs them.
 */
export default defineConfig({
  test: {
    reporters: ["default", new Durations()],
    include: ["desktop/**/*.test.ts"],
    environment: "node",
    // One application at a time: tauri-driver listens on one port.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
