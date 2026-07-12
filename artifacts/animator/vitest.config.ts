import { defineConfig } from "vitest/config";
import path from "path";

// Standalone test config. The app's vite.config.ts deliberately throws when
// PORT/BASE_PATH are missing, so tests use this minimal config instead. Tests
// run in the node environment — the dungeon navmesh + damage modules are
// pure-data (no DOM / Three.js). Visual-effect modules that build CanvasTextures
// at construction time (telegraph rings, indicators) need a `document.createElement
// ("canvas")`; the setup file below installs a lightweight no-op canvas stub so
// those suites run without a heavy jsdom/happy-dom DOM environment (keeps the
// OOM-safe single-fork run lean — see .agents/memory/animator-vitest-oom.md).
export default defineConfig({
  resolve: {
    alias: [
      // `@assets/*` URL imports (e.g. self-hosted .wav one-shots) have no bundler
      // under the node test env; collapse them to an empty-string default so engine
      // modules that import asset URLs can be loaded by tests.
      { find: /^@assets\/.*/, replacement: path.resolve(import.meta.dirname, "src/three/__test-stubs__/assetUrl.ts") },
      { find: "@", replacement: path.resolve(import.meta.dirname, "src") },
    ],
  },
  // Component render tests (react-dom/server) need the automatic JSX runtime;
  // the app's tsconfig uses `jsx: preserve` and relies on Vite's React plugin,
  // which isn't loaded by this standalone config.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    setupFiles: [path.resolve(import.meta.dirname, "src/three/__test-stubs__/canvasStub.ts")],
  },
});
