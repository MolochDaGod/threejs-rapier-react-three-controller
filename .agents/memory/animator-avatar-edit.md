---
name: Animator Avatar Edit cube head builder
description: Design decisions for the Avatar Edit mode (pixel-face composer + protrusion boxes + WebGL-failure fallback)
---

# Avatar Edit — cube modular head builder

- The head is composed entirely in a pure layer: config → six 16×16 packed-int
  pixel grids + axis-aligned "protrusion boxes" (ears/tusks/mohawk/braids) in
  head-local units (unit cube, 1px = 1/16). Keep ALL new part styles in that
  pure layer so they stay deterministic and unit-testable without THREE/DOM.
  **Why:** headless env has no WebGL, so tests can only cover the pure compose.
- Catalog (`catalog.ts`) is the single source for style lists — both the
  composer switch statements and the UI chips read it. Adding a style = extend
  the union + list + one composer case; forgetting the composer case renders a
  silent no-op, so keep switches exhaustive.
- Any mode that constructs `THREE.WebGLRenderer` in a React effect must catch
  the constructor throw and degrade (panel stays usable, stage shows a notice).
  **Why:** WebGL can be absent/blocked; an uncaught throw takes down the whole
  React tree (seen in preview screenshots). HeadStage pattern: create the
  renderer FIRST (throw-prone, leaks nothing), wrap the rest of init in
  try/catch → dispose() → rethrow, with dispose null-guarding late-init fields.
- Hair/beard "physics" is a cheap pivot rig (`hairMotion.ts`), not real physics:
  boxes carry an optional `motion` tag (anchor + sway + gravity, set in the pure
  compose layer) and renderers wrap tagged meshes in a pivot group at the anchor.
  Segments of one braided lock share ONE anchor so the whole braid swings as a
  rigid rope (same wind phase). **How to apply:** any transform applied to boxes
  in `applyAdjustments` MUST also transform the motion anchors or swings detach
  from the mesh; angle math (`gravityLean`, `motionPhase`) stays pure/tested.
- Braided volume (dreads, beard braids) is `braided: true`: weave texture
  variant in `buildHairTexturePixels`, and `buildStrandDescriptors` skips them
  (loose flyaway strands blur a tight braid). Light fringe (`motion.light`)
  renders translucent + flutters faster.
- Hair textures are high-res (320 texels/unit, clamp 16..512) but strand LANE
  COUNT is resolution-independent: lane width = cols/24, extra texels buy
  smooth cylinder shading INSIDE each strand. **Why:** scaling density without
  scaling lane width just makes ever-thinner noise stripes, not realism. Fill
  canvases via ImageData blit (per-pixel fillRect is too slow ≥256²); textures
  use linear+mipmaps+anisotropy, materials are MeshPhysicalMaterial with sheen
  + a luminance-derived bumpMap (dispose BOTH textures in the handle).
- Beard boxes join the realistic hair pipeline via `p.hair || p.slot ===
  "facialHair"` in BOTH renderers (HeadStage + playerHead) — beards must never
  be tagged `hair: true` (tests pin scalp-hair tagging), so renderers key off
  the slot instead. Braided beards still get zero strands via the shared
  `!braided` filter.
- Side hair + beards get a FINE texture variant (4×-thinner lanes gathered
  into 7-lane clumps with dark separation grooves + deeper bump/sheen, 2×
  texel density). The decision is a pure classifier: facialHair slot always
  fine; scalp hair fine only when |x| > 0.45 (side curtains/panels — crown
  slabs/tufts stay ≤0.44); braided always wins over fine. **Why:** the
  classifier lives inside the material factory, so both renderers pick it up
  with zero renderer edits; keeping it pure keeps it headless-testable.
- HeadStage's dispose traverse must treat anything UNDER `protrusionGroup` as
  owned-elsewhere — motion meshes are nested inside pivot groups, so a direct
  `children.includes` check would double-dispose the shared box geometry.
- Door posters live at `public/rooms/<name>-scene.png` and must match the dark
  neon voxel-arcade style of the existing five cards or the grid looks broken;
  the first bright/cartoony generation stood out badly and was regenerated.
