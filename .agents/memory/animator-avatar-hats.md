---
name: Animator avatar GLB hats
description: Lessons from mounting Sketchfab GLB hats on the cube avatar head (orientation quirks, offline verification, lifecycle).
---

- **Sketchfab roots can carry sloppy "display pose" quaternions.** The voxel hat's
  `Sketchfab_model` root had ~-82° X (tilted for the store preview) instead of the
  exact -90° X that cancels the inner Z-up→Y-up +90° X node. Snap the root quat to
  exact `(-SQRT1_2, 0, 0, SQRT1_2)` at load, don't try per-hat euler nudges.
- **Nodes inside one pack GLB don't share a facing axis.** Most hats in the pack
  face ±Z but the astronaut helmet faced ±X. Corrective yaw must be applied via a
  pivot group BEFORE the bbox fit/centre/base pass so normalization accounts for it
  (`raw.rotation.y +=` after decompose composes in euler space — wrong).
- **Verify orientation offline, never by eye in the app.** Headless browser has no
  WebGL. Read the GLB with gltf-transform in Node, bake node world matrices onto
  vertices, replicate the normalize math, and splat front/side point clouds over a
  head-cube outline with sharp (`scripts/src/verify-hats.mjs`). Low-poly voxel
  meshes splat only corner verts — check the union bbox numbers before concluding
  a model is broken.
- **Lifecycle:** hat templates are cached forever (never disposed); each mount is a
  clone sharing template geo/mats, so mount handles only detach + a cancelled flag
  guards async attach-after-dispose. Stage dispose must drop the hat mount BEFORE
  any scene traverse that disposes mesh resources.
- **Hair/hat interplay is crown-only:** a hat suppresses crown-volume hair (slab,
  mohawk/topknot/wild), but long-hair side curtains, back sheet, and below-jaw fall
  intentionally survive.
