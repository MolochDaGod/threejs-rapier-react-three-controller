import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import path from "path";

// PORT and BASE_PATH are optional — defaults work for local dev and Vercel.
const port = Number(process.env.PORT) || 3000;
const basePath = process.env.BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    // Rapier / wasm modules (and any future wasm) need these in Vite 7.
    wasm(),
    topLevelAwait(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // The Phantom browser SDK imports Node's "buffer" module; point it at
      // the browser polyfill so signing works in the browser.
      buffer: "buffer/",
    },
    // Single three instance — avoids postprocessing/quarks peer skew.
    dedupe: ["react", "react-dom", "three", "@dimforge/rapier3d-compat"],
  },
  optimizeDeps: {
    // Prebundle three so HMR and postprocessing share one copy.
    include: ["three", "postprocessing"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: false,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: false,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
