import { defineConfig } from "vitest/config";

// Standalone config for the danger-net test runner, mirroring the carrier-net
// setup. The relay helpers are pure (no three/ws/node deps), so tests run in the
// node environment.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
