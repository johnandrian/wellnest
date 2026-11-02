import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts"],
    // The whole suite runs in parallel; the slower pipeline tests need more than the 5 s default.
    testTimeout: 20_000,
    server: { deps: { inline: ["convex-test"] } },
  },
});
