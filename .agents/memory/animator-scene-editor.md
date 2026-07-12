---
name: Animator Dressing Room (was Scene Editor)
description: The 3rd-door mode in the Animator app — repurposed from a generic 3D Scene Editor into a focused character/wardrobe/animation/VFX "Dressing Room". Covers its engine/React boundary and what UI was removed.
---

# Animator Dressing Room (was Scene Editor)

**Repurposed to "Dressing Room".** This mode was rebranded from a generic 3D
"Scene Editor" into a focused character studio: Wardrobe (swap rig/skins + attach
gear), Animations, VFX, and Playground panels, plus transform gizmos + import/export.
The generic 3D-authoring UI was REMOVED — add-primitives, structural build brushes,
the Hierarchy/Layers/Inspector panels, and the Colliders view toggle (those panel
component files were deleted), AND the matching AI tools in `src/ai/editorTools.ts`
(`add_primitive`/`add_primitives`/`set_build_brush`/`toggle_colliders`).
**The internal App mode id stays `"editor"`** (renaming touches too many places) —
only user-facing text says "Dressing Room". On entry it auto-loads a default rig via
`engine.loadRig()` when no gallery scene is reopened.
**Why:** the user wanted a character-focused tool, not a general scene editor.
**How to apply:** the engine (`EditorScene`) still HAS the removed setters
(`addPrimitive`/`setBuildKind`/`toggleColliders`) — only their UI + AI surface was
pruned. The sections below documenting build brushes / layers / unified hierarchy
describe engine internals that remain, but are no longer user-reachable.

A self-contained 3D editor reachable from the third door (`DoorSelect` →
App mode `"editor"`, early-return like `"doors"`). Lives in
`src/three/editor/` (engine) + `src/components/editor/` (UI). Plain Three.js, no
@workspace imports, no r3f — same disposable-engine pattern as `Studio`/`VoxelEditor`.

## Engine ↔ React boundary

`EditorScene(container, onChange)` owns renderer/OrbitControls/TransformControls,
an object registry, collider wireframes, layers, a `Vfx` player, and an
`ExplorerCharacter` rig for animation preview. It is the single source of truth
and pushes an immutable `EditorSnapshot` via `onChange`; panels call imperative
setters back. **Every mutating method must call `emit()`** or the UI goes stale —
this bit `previewClip()` (it changes `rigPlaying` but originally didn't emit).

**Why:** React never reaches into the engine's mutable Three objects; it only
reads snapshots. A setter that mutates without emitting leaves the panel showing
old state until some unrelated action emits.

## Async clip readiness

Rig clips (and weapon-set swaps) load asynchronously, so `rigClips` is empty for
a beat after `loadRig`/`setRigWeapon`. `AnimLibraryPanel` polls `engine.refresh()`
until `rigClips.length > 0` (capped ~12s), rather than a fixed tick count, so a
slow load can't leave the list permanently empty.

## three r0.184 gizmo gotchas

- Add `gizmo.getHelper()` to the scene, NOT the `TransformControls` instance.
- Disable `OrbitControls` on the gizmo's `dragging-changed` event or orbit fights
  the drag.
- `three` must stay in Vite `resolve.dedupe` (jsm addons pull a 2nd copy → the
  "Multiple instances of Three.js" warning).

## Disposal

`dispose()` must also remove+dispose the constructor-created scene helpers
(`GridHelper`, `AxesHelper`) — `renderer.dispose()` does NOT free their
geometry/material, so repeated enter/exit leaks GPU memory otherwise.

## Fish-eye-on-occlusion camera assist

`updateFishEye(dt)` (run in the loop) widens the perspective camera FOV toward a
fish-eye (~102°) while a visible non-terrain mesh sits between the camera and the
"terrain point" (nearest visible object on the user-marked `terrainLayerId`, else
the ground plane y=0 under `orbit.target`), easing back to baseFov (55°) otherwise.

- **`fishEye` defaults OFF.** In the character-centric Dressing Room the dressed
  rig stands between camera and terrain, so the assist popped the FOV every frame
  and read as the camera "spazzing". It's an *environment-authoring* assist; off
  is correct for a character studio.

- Use a **dedicated** `fishRay` raycaster — never the picking `raycaster`:
  `setFromCamera` doesn't reset `.far`, so sharing it silently breaks selection.
- Clamp `fishRay.far = dist - 0.1` and skip the cast when that's ≤ ~0.01, or a
  near-coincident terrain point yields a negative/degenerate far.
- `emit()` ONLY on the `fishEyeActive` boolean transition, not per frame, or React
  churns every frame; the FOV damp itself stays engine-side.
- Terrain layer is opt-in: a per-layer ⛰ toggle in `LayersPanel` calls
  `setTerrainLayer(id|null)` (radio-style); `deleteLayer` must clear it.
- Reuse scratch `Vector3`/`Box3` fields — the per-frame loop allocates otherwise.

## Structural build brushes (LMB drag-to-build)

Toolbar Build group (Wall/Ramp/Pillar/Slab) + H/T inputs. `setBuildKind(kind)`
toggles a draw tool: while active, LMB is remapped OFF orbit (`orbit.mouseButtons =
{LEFT:null, MIDDLE:DOLLY, RIGHT:ROTATE}`) so left-drag pulls a shape out on the
y=0 ground plane (ray ∩ plane, snapped via the existing Snap toggle); right-drag
orbits. Null restores the default `{LEFT:ROTATE,MIDDLE:DOLLY,RIGHT:PAN}`.

- **The gizmo must be detached while a brush is active** or it steals drags;
  `select()` skips `gizmo.attach` when `buildKind` is set, and exiting build mode
  re-attaches to the current selection. Picking a W/E/R gizmo also force-exits build.
- **Pointer lifecycle must be capture-based**: call `setPointerCapture` on build
  start (release on up), or a release off-canvas never fires `pointerup` and the
  tool sticks in `building=true` with a stale preview. Also `cancelBuild()` at the
  top of `setBuildKind` so switching brushes mid-drag can't strand a preview.
- `buildSpec(S,E)` maps two ground points → geo+placement: wall/ramp are *linear*
  (length+yaw from the drag line), slab/pillar are *area* (rectangle footprint);
  tiny drags fall back to fixed defaults so a click still places something.
- Ramp = hand-built right-triangular-prism (`makeWedgeGeo`), base at y=0; build it
  indexed then `toNonIndexed()+computeVertexNormals()` for flat shading.
- Built objects are tagged `kind:"box"` (collider/naming are box-based); the
  human label (Wall/Ramp/…) lives only in `name`. No PrimitiveKind was added.

## Unified hierarchy: one registry for primitives + imports + rig

The object registry is **flat-with-`parentId`** wrapping `Object3D` (not `Mesh`),
so any Object3D graph (imported model, the procedural rig with its bones/skinned
meshes) registers into the SAME outliner via a subtree walk; the snapshot is
DFS-ordered. **Why:** the original flat primitive-only list is why a loaded rig
rendered but was invisible to outliner/gizmo/inspector. Recursive picking needs
`intersectObjects(...,true)` + walking `userData.objId` up to a registered
ancestor.

**Rig internals must not be edited piecemeal.** Gate delete/reparent/duplicate so
a rig bone/skinned mesh is a no-op; only the rig root deletes (via the rig's own
teardown). **Why:** detaching/disposing a bone through the generic object path
corrupts the live `ExplorerCharacter` skeleton. Attaching an *external* object
onto a rig bone (bone-attach) is fine — only a rig node as the moved *child* is
blocked.

**Cloning a skinned subtree needs `SkeletonUtils.clone`, not `Object3D.clone`** —
plain clone leaves the copy's bones bound to the *source* skeleton.

## Imported animation clips are a separate system from rig clips

Rig clips come from `ExplorerCharacter`; imported-model clips do NOT — they need
their own `AnimationMixer` per imported root (keyed by root node id), ticked in
the loop, and stopped+dropped when that subtree is removed. The snapshot exposes
them separately (`importedClips` grouped by root + `importedPlaying`), and the
Animations panel renders them in their own section. Source of the clips differs by
format: **GLB → `gltf.animations`, FBX → the returned Group's `.animations`** (and
`GLTFExporter` only embeds clips you pass via its `animations` option). Imported
nodes get `frustumCulled=false` or skinned bounds go stale. All async file ops
(import/convert/export) flip the `busy` flag so the File toolbar serializes.

Selection highlight is an `OutlinePass` in an `EffectComposer` (replaced the old
`BoxHelper`); bloom is a toggled `UnrealBloomPass`. Dispose composer + passes.

## Playground / Play mode (drive a character in the editor)

The editor doubles as a "Playground": load externally-hosted Grudge race
characters (vendored kit in `src/three/grudge/`, asset base
`VITE_ASSET_BASE ?? https://assets.grudge-studio.com`) and drive one with the
Animator's existing `Controller` (3rd-person move/cam) + fire `Vfx`.

- `GrudgeAvatar` must satisfy the SAME `Avatar` interface `Character.ts` does, so
  `Controller` drives it unchanged — key clips by a LOGICAL key
  (idle/walk/run/attack/sprint), NOT `clip.name`, or run/sprint collide.
- Grudge chars register as `kind:"model"` subtrees (tracked in a `grudge`
  Map<rootId,avatar>); `removeObject` routes those ids to `unloadGrudge`. The loop
  ticks every grudge avatar.
- Play mode: `startPlay(rootId?)` builds `Controller(driven,camera,input,params)`,
  disables orbit+gizmo, pointer-locks; the loop BRANCHES (controller.update vs
  orbit+fishEye). `stopPlay()` removes listeners, exits/disposes `InputState`,
  restores idle+orbit. Guard ALL editor pointer handlers with
  `if (this.playing) return` (down-capture, down, up) so selection/gizmo don't fire.
- **`driven: Avatar|null` is the character the Controller actually drives** —
  grudge if one is selected/spawned, else falls back to `this.rig` (the dressed
  rig) so the Dressing Room's Edit/Play toggle works on whatever's on the stand.
  `playAvatar` stays grudge-only (Skill Lab targeting); route VFX origin/facing
  and play input handlers through `driven`, not `playAvatar`.
- **Swapping/unloading the rig mid-Play must `stopPlay()` first** when
  `driven === this.rig` (guard in BOTH `loadRig`'s in-place swap and `unloadRig`),
  or the Controller is left bound to a disposed avatar.
- **dispose() must `stopPlay()` then let the `removeObject` loop unload grudge
  avatars** — do NOT also dispose them in a separate explicit loop first, or the
  generic subtree path double-disposes already-freed GPU resources. Iterate a
  snapshot (`[...this.objects]`) since `unloadGrudge` mutates the map.
- Stale-token branch in `loadGrudgeCharacter` must `emit()` after clearing `busy`
  (concurrent loads otherwise desync the busy flag → stuck "Loading…").

## Layer visibility must not clobber intrinsic per-mesh visibility

`registerSubtree` ends by calling `applyLayerVisibility`, which originally hard-set
`object.visible = layer.visible` for every node. That destroyed any mesh hidden
*before* registration — most visibly a Grudge gear preset, which hides every
non-equipped weapon/body mesh, so a freshly spawned character showed ALL weapon
variants + both body variants at once ("two bodies + all three weapons").

**Rule:** each `EditorObject` carries `baseVisible` (the node's own `.visible`
captured at registration, at all four construction sites); effective visibility is
`layerVisible && baseVisible`. **Why:** layer state and intrinsic state are
independent axes — the layer system owns one, the source mesh owns the other.
**How to apply:** `exportJSON`/`toSnapshot` must serialize `baseVisible` (intrinsic),
NOT `object.visible` (effective), or a scene saved while a layer is hidden bakes
those nodes permanently hidden on re-import. There is no per-object visibility
toggle in the UI; if one is ever added, route it through `baseVisible` (not a raw
`node.visible` write) or `applyLayerVisibility` will undo it.
