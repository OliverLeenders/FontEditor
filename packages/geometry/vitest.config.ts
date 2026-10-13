import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    /*
     * Longer than vitest's five seconds, as font-io's is and for its reason.
     *
     * The tests of a stroke's ink hold it against the pen swept along the path
     * the slow way, at a thousand points and more: a second and a half to three
     * seconds each on an idle machine, and five times that on one running the
     * other packages' tests beside them. A test that times out there and passes
     * on the next run says nothing about the code. What is still caught is work
     * that never finishes.
     */
    testTimeout: 30_000,
  },
});
