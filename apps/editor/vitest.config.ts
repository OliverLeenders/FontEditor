import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Node, not jsdom. The app layer's browser dependencies are a handful of
    // globals — matchMedia, innerWidth, localStorage — which the tests stub
    // directly. Nothing here renders a component, so a full DOM would be a
    // dependency bought for nothing.
    environment: "node",
  },
});
