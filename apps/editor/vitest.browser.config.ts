import { defineConfig } from "vitest/config";

/**
 * The tests that need a browser, kept apart from the ones that do not.
 *
 * Everything in `test/` runs under Node against storage made of a Map, which is
 * quick and is most of what can go wrong. What it cannot say is whether the
 * built editor — its worker bundled, its code minified, its policy in force —
 * keeps a font in a real browser's own storage across a reload. These open the
 * production build in a headless Chromium and do what a person does.
 *
 * Not part of `pnpm test`: they want the editor built and a Chromium fetched,
 * and take a minute. `pnpm test:browser` builds and runs them.
 */
export default defineConfig({
  test: {
    include: ["browser/**/*.test.ts"],
    environment: "node",
    globalSetup: ["browser/serve.ts"],
    // One Chromium at a time: each file launches its own, and a machine with
    // two cores is what these run on.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
