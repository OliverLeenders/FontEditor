import { defineConfig } from "vitest/config";

import Durations from "../../tools/durations/reporter.mjs";

export default defineConfig({
  test: {
    // And what passed close to its time limit: see tools/durations.
    reporters: ["default", new Durations()],
    include: ["test/**/*.test.ts"],
    environment: "node",
    /*
     * Longer than vitest's five seconds, because of what these tests do.
     *
     * Several of them compile a whole font, remove overlaps from real outlines,
     * or deflate a WOFF2 — a second's work each on an idle machine, and several
     * seconds on one that is also building the editor or running CI's other
     * jobs beside them. Failing there says nothing about the code: the same
     * test passes on the next run, which is the definition of a test not worth
     * having. What is still caught is work that never finishes.
     */
    testTimeout: 30_000,
  },
});
