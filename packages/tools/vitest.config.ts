import { defineConfig } from "vitest/config";

import Durations from "../../tools/durations/reporter.mjs";

export default defineConfig({
  test: {
    // And what passed close to its time limit: see tools/durations.
    reporters: ["default", new Durations()],
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
