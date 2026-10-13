import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    /*
     * Longer than vitest's five seconds, as font-io's and geometry's are.
     *
     * A stroke's ink is held against the pen swept along its path, and against
     * what the font is given, point by point: seconds each, and more on a
     * machine doing something else. The slowest say how long they may take
     * themselves; this is for the ones that are a second or two on a good day
     * and were over five on CI's worst.
     */
    testTimeout: 30_000,
  },
});
