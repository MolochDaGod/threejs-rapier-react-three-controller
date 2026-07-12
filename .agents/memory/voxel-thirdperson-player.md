---
name: Voxel Game Studio third-person player
description: Durable decisions for the third-person animated player in voxel-engine play mode (camera ownership, view save/restore, animator weapon mapping).
---

# Third-person player (Game Studio / voxel-engine play mode)

A visible animated avatar (`@workspace/animator` `createAnimatedCharacter`) shown
in third-person view, with a first/third toggle (`KeyV`).

## Decisions (non-obvious)

- **Controls owns the play camera, not the systems.** One owner centralizes both
  framings (first-person glues to the eye; third-person orbits behind the body
  with a `raycastVoxels` collision clamp). Movement code moves the BODY only; the
  camera is applied afterward.
  **Why:** scattering camera math across systems caused drift and broke
  save/restore consistency.

- **`getView()` returns the EYE, not the raw camera.** In third person the camera
  sits behind the player, so saving/restoring it would teleport the player
  backwards each load. Any new player save/restore must go through
  `getView`/`setView`, never the camera transform.

- **View mode lives in the project snapshot, not (only) device settings.**
  `PlayerState.view` round-trips per project; `settings.view` is just the device
  DEFAULT for fresh worlds. On build, settings.view is applied first, then restore
  overrides with the saved snapshot view. `KeyV` toggles live + updates the device
  default.
  **Why:** review required per-project persistence; device-local alone failed it.

- **PlayerController acts from the eye, not the camera.** Raycast/fire/cast/
  vitals/drop all originate from `controls.getEyePosition()` so mining/shooting/
  drops behave identically in both views.

- **Wheel is view-gated.** Third-person walk → wheel zooms the orbit distance
  (clamped); first-person → wheel selects the hotbar. Each handler early-returns
  for the other view so they never fight over the same event.

- **Every held tool/weapon maps to the animator `"sword"` hand prop.** The
  animator ships fixed `WeaponClass` props only (`unarmed|sword|knife|ranged|bow|
  magic`) and we must NOT edit `lib/animator`; `unarmed` mounts NOTHING. Mapping
  pickaxe/axe/shovel to `unarmed` made equipped tools invisible — map any
  tool/weapon to a class that mounts a visible prop (`sword`), spells to `magic`.
  **How to apply:** when adding item kinds, never route a held implement to
  `unarmed` expecting a mesh.

- **Settings carry a `schema` version for one-time prefs migrations.** Bump
  `SETTINGS_SCHEMA` to apply a one-time fixup on load and re-persist (used to
  force `invertY=false` so look is "up is up") instead of clobbering choices every
  load.

## Third-person camera occlusion (smooth, foliage-aware, fade)

- **Two complementary mechanisms, not one.** A spring-smoothed orbit distance
  (pull-in fast, ease-out slow; frame-rate-independent via `1 - exp(-rate*dt)`)
  handles real walls; a terrain-shader dither cutout fades *residual* occluders
  so the camera never has to slam fully in. Tunables live as `TP_*` constants in
  `Controls.ts`.
- **Collision uses a THICK cast, not one center ray.** A center + 4 corner probes
  (offset in the camera's perpendicular right/up basis) take the nearest hit so
  the camera's edges don't clip corners/thin geometry.
- **Foliage is camera-only see-through.** The orbit raycast passes an `ignore`
  predicate (built from `meta.foliage` block ids) so leaves never yank the view;
  this MUST stay a camera concern — gameplay raycasts omit the predicate, so
  foliage still renders and collides normally.
  **Why:** walking under a canopy used to snap the camera in hard.
- **The fade is a cam→player tunnel cutout in the terrain frag shader**, driven by
  `uOcclusionFocus/Radius/Near` uniforms pushed each frame
  (Controls.getCameraFocus → ChunkRenderer.setCameraOcclusion → StylizedMaterials).
  It dither-discards fragments inside the tunnel; disabled (radius 0) outside
  third-person so first-person/fly never dither terrain. `uOcclusionNear` keeps a
  margin of solid in front of the player so the ground isn't punched through.

## Gotcha: adding a `@workspace/*` lib to an artifact

Wiring a lib into an artifact needs the dep + tsconfig `references` + install + lib
build AND a **Vite workflow restart** — HMR alone keeps throwing
`Failed to resolve import` until Vite re-optimizes deps on a fresh start.
