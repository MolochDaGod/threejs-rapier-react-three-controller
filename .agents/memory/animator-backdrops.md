---
name: Danger Room backdrops
description: Full-scene battle-art backdrops swap scene.background to a Texture; why that is safe against the per-frame fog writes.
---

Danger Room backdrops (`BACKDROPS` in RoomPresets.ts, session-persisted) paint a
full-scene battle image by setting `scene.background` to a `THREE.Texture` via
`Studio.setBackdrop(id|null)`.

**Why it doesn't fight the fog system:** every place that mutates the background
each frame or on preset change (`writeBaselineFog`, the water-fog tint, preset
atmosphere) guards on `this.scene.background instanceof THREE.Color`. A texture
background is therefore left untouched by all of them. `setBackdrop(null)` must
explicitly restore a `Color` (`baseBgColor.clone()`) so the fog baseline owns the
background again — `writeBaselineFog` won't do it while a texture is set.

Load is token-guarded (dispose superseded/late textures), and `dispose()` frees the
active texture. This is the general pattern for any "override the background with an
image" feature here: set a Texture, rely on the Color guards, restore a Color on clear.
