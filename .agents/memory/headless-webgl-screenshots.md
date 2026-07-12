---
name: Headless WebGL screenshots
description: Why app_preview screenshots fail for Three.js/WebGL apps and how to verify instead.
---

The `app_preview` screenshot tool runs in a headless browser with no GPU. Any
Three.js / WebGL app will log "Could not create a WebGL context" (VENDOR =
0xffff) and the WebGLRenderer constructor throws there — even though the app
renders fine in the user's real browser.

**Why:** the screenshot environment has no hardware acceleration; this is an
environment limitation, not a bug in the app.

**How to apply:**
- Do not treat a WebGL context error in a screenshot as a real failure.
- Wrap renderer/engine init in try/catch and show a friendly fallback message so
  the app degrades gracefully instead of white-screening (also good for users on
  machines without WebGL).
- Verify correctness via `pnpm --filter <pkg> run typecheck` and by confirming
  the non-canvas UI (HUD/overlays) renders in the screenshot, rather than
  expecting the 3D scene to appear.
