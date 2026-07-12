---
name: Player badge, 2D avatar portrait & GBUX currency
description: Landing-page player badge/character panel, WebGL-free head portrait rendering, and the GBUX soft-currency store future economy work must route through.
---

# Player badge / portrait / GBUX

- **GBUX is the soft currency.** Balance lives in a localStorage-backed store
  (`src/lib/gbux.ts`) with a `useSyncExternalStore` hook. Nothing earns or
  spends yet — every player gets a fixed starting grant.
  **Why:** the badge/panel needed a real number; the store pre-exists the economy.
  **How to apply:** any future shop/reward feature must mutate via `addGbux`/`setGbux`
  (so subscribers update), never write the localStorage key directly.
- **Avatar portraits render without WebGL.** The Avatar Edit cube head has a pure
  front-projection (`src/three/avatar/portrait.ts`): composeHead → front Grid +
  protrusion boxes split under/over the z=+0.5 front plane, blitted to a 2D canvas
  data URL. **How to apply:** reuse this for any thumbnail/list view of player heads
  (gallery, lobby rosters) instead of spinning up a renderer.
- The doors landing screen is now a scrollable flex column with auto-margin
  centering (`.doors-head { margin-top:auto }` / `.doors-row { margin-bottom:auto }`)
  — content centers on tall screens but scrolls instead of clipping on short ones.
  Keep this if adding more landing content.
- Character panel gold theme (`gw-*` classes, Cinzel/JetBrains Mono) mirrors
  info.grudge-studio.com/main-panel.html; fonts load from Google Fonts in index.html
  and degrade to Georgia/monospace offline (Cloudflare mirror unaffected).
