import { defineConfig } from "vitest/config";
import path from "path";

// Standalone runner config, mirroring the other workspace libs. The loader is
// pure data → Three.js objects (no WebGL), so the tests run in the node env.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
