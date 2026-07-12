---
name: Shared asset texture-atlas matching
description: How FBX/OBJ props in lib/assets get the right shared atlas; why mesh-name matching alone fails.
---

# Picking the right shared atlas for Synty-style packs

Synty FreeSample FBX/OBJ packs share a handful of texture atlases
(`T_PropsA`, `T_PropsB`, `T_Boat`, `T_Buildings`, ...) across many meshes.
`lib/assets` redirects the actual image fetch to a 1x1 blank pixel and applies its
own bundled downsampled atlases — so the loader must decide which bundled atlas
each material wants.

**Key fact:** FBXLoader (and OBJ via MTL) still sets `material.map.name` to the
FBX texture node's name (e.g. `T_PropsA_diffuse`) even when the image URL was
redirected to the blank pixel. That name is the reliable signal of intent.

**Rule:** match each material to a bundled atlas by, in priority,
`material.map?.name` → `material.name` → mesh name. Matching on mesh name alone
fails badly — it falls back to the first atlas alphabetically (`t-boat`), so every
tropical prop ends up wearing the boat atlas.

**Why:** the wrong-texture bug ("every Open Water prop looks like the boat") was
exactly this fallback. Fixed by name-key matching with exact-before-substring and
a colour-vs-aux (emissive/normal/ao/...) split so `.map` only ever gets a
base-colour atlas.

**How to apply:** when adding/altering packs, keep the bundled atlas filenames'
distinctive token (`propsa`, `boat`, `buildings`) intact so `nameKey()` collapses
both the FBX node name and the bundled file to the same key. Verify tropical FBX
visually — Puter's cross-origin guest-auth splash blocks the screenshot tool, so
boat-scene checks are manual/user-driven.
