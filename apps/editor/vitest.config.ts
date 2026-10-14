import { defineConfig } from "vitest/config";

import Durations from "../../tools/durations/reporter.mjs";

export default defineConfig({
  test: {
    // And what passed close to its time limit: see tools/durations.
    reporters: ["default", new Durations()],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // Node by default, still: the store, the scene builder and the menu are
    // tested against a handful of stubbed globals, and running them in a DOM
    // would cost several seconds per file for nothing.
    //
    // The component tests say `@vitest-environment jsdom` at the top of the
    // file, which is per-file and leaves the rest alone.
    environment: "node",
  },
});
