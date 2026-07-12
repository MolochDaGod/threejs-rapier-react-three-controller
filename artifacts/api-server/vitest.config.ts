import { defineConfig } from "vitest/config";

// Unit tests for pure server helpers (e.g. wallet ownership-proof
// verification). Route handlers themselves are exercised in dev/preview.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
