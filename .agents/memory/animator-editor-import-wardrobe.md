---
name: Animator editor universal import + wardrobe
description: Scene Editor's any-file import pipeline + skin/gear wardrobe — vendored loaders and the non-obvious texture/zip gotchas.
---

# Scene Editor: universal import + wardrobe

The Scene Editor (3rd door) takes ANY asset via one `EditorScene.importFile(file)`
dispatcher (extension-routed) shared by the File menu and viewport drag-and-drop.
Supported: `.glb .gltf .fbx .obj .zip .bbmodel/.bb`. Everything is vendored under
`src/three/editor/loaders/` — the animator artifact forbids `@workspace` runtime imports.

## Non-obvious rules (these bit us / the architect caught them)

- **Replacement skin textures must use `flipY = false`.** `applySkin()` recolours/
  retextures a subtree's materials live. glTF/FBX rigs (the wardrobe's main targets)
  author UVs top-left, so a `TextureLoader`-loaded map (default `flipY=true`) comes out
  vertically inverted. Set `flipY=false`. **Never dispose** the old `.map` — it's often a
  shared atlas owned by the rig/asset cache.

- **ZIP reader is dependency-free and bounded.** `unzip.ts` parses EOCD + central dir and
  inflates via `DecompressionStream("deflate-raw")` (fflate could not be linked in this
  sandbox). It MUST cap inflated output (per-entry + whole-archive budget) and fail fast —
  an unbounded inflate is a zip-bomb DoS that OOMs the tab. Skips dirs/`__MACOSX`/`._*`.

- **`.gltf` bundles (json + .bin + textures) need a blob-URL resolver.** Self-contained
  `.glb` parses directly; a multi-file `.gltf` in a zip resolves its sidecars via a
  `THREE.LoadingManager.setURLModifier` that maps each archive entry (by full path AND
  bare filename) to a `URL.createObjectURL` blob, then `GLTFLoader(manager).parseAsync`.
  Revoke the blob URLs in `finally` — parseAsync resolves only after deps load, so it's safe.

- **Gear attach/detach keeps the node-registry `parentId` in sync.** `attachGear()` uses
  `targetObj.attach()` (preserves world transform) onto the char root or a named bone
  (`findBone` = exact-then-partial match) and sets `gear.parentId` to the resolved target's
  registry id; `detachGear()` re-attaches to scene root + nulls parentId. If you add new
  re-parenting paths, update parentId too or the Hierarchy panel goes stale.

## UI

Persistent tool rail in `EditorMode.tsx` (Select/Move/Rotate/Scale/Snap/prims/build/import)
with active state driven by `snap.gizmo`/`snap.buildKind`/`snap.snap`. Dock zones clear the
rail via `DockSurface menuHeight={96}` (zone top = menuHeight+8). Drag-and-drop uses a depth
counter on the `.dock-root` for enter/leave and a `.ed-drop` overlay. Wardrobe panel lives
in `WardrobePanel.tsx` (char picker + swatches/color/texture + material sliders + gear rows).
