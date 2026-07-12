---
name: Animator Danger Room Voxel Editor controls
description: Mouse-control convention for the Danger Room VoxelEditor (build vs camera).
---

# Danger Room Voxel Editor mouse convention

In `artifacts/animator/src/three/voxel/VoxelEditor.ts` the editor splits **build**
and **camera** across the two main mouse buttons so building never fights the
camera:

- **LMB** = build the active brush. Block tools paint on `pointerdown` AND keep
  painting through the drag (hold-and-drag to stack / wall / ramp). LMB NEVER
  orbits or pans.
- **RMB drag** = orbit the camera. **RMB click** = erase (block or deployable).
- Middle-button drag or Shift+drag = pan. Wheel = zoom.

**Why:** the user explicitly wanted drag-to-build, with the camera moved off LMB
onto RMB. The old scheme orbited on any LMB drag and only placed on a click.

**How to apply / gotchas:**
- Continuous build dedupes by cell via `lastPlaceKey` (`"x,y,z"`) so the same
  cell isn't re-added across consecutive `pointermove` events.
- Deploy tools are the exception: single place on LMB **click** only (a drag
  would otherwise spam many NPCs/bags). Guard with `brush.tool !== "deploy"`
  before continuous `paintBlockAtPointer()`.
- Click-vs-drag is gated by `dragMoved` (DRAG_THRESHOLD px). LMB places on
  down/move, so `pointerup` must NOT also place for LMB (avoids double-place).
- This is the **Danger Room** VoxelEditor; the separate voxel *Studio* has its
  own control scheme (see `voxel-studio-controls.md`).

## DangerRoom is shared by play mode AND the editor

`DangerRoom` is constructed by BOTH `Studio` (Danger play, closed enclosure) and
`VoxelEditor` (open pad). It takes `{ open?: boolean }`: open skips
walls/ceiling/pillars/door (and `obstacles` returns []) so the editor camera is
never boxed in; default (closed) keeps the full chamber for gameplay.
**Why:** the user repeatedly asked not to be "stuck looking at the black box"
when authoring. **How to apply:** never make the editor's environment changes by
editing the shared closed-room build — branch on `open`, or play mode breaks.
The editor also picks a brighter background/fog than the play room.

## Deployable placement occupancy (don't bury assets)

Deployables (NPC / bag / prop / start) go through ONE occupancy model in
`VoxelEditor` — never re-implement ad-hoc per-kind placement:

- Each deployable owns a **footprint** of grid cells at the level (`y`) it stands
  on. Footprint half-extent (`deployRadius`) is single-cell for NPC/bag/start and
  the **static authored** `PropDef.footprintRadius` for GLB props (`propRadius`).
  The radius MUST be deterministic at click time — do NOT derive it from an async
  template-bbox measurement (a large prop's first placement would validate as
  single-cell before the GLB loads, allowing overlap). Author `footprintRadius`
  from the model's measured *normalized* X/Z (larger axis / 2, rotation-invariant)
  — measure GLBs offline by reading POSITION-accessor min/max from the GLB JSON
  chunk + applying node transforms (props use webp textures, so gltf-transform
  `NodeIO.read` throws without the extensions pkg; parsing the JSON avoids it).
- `footprintCells` only claims a neighbour cell when the footprint covers ≥
  `FOOTPRINT_COVER` (0.5) of it on BOTH axes, so a prop poking marginally past a
  boundary doesn't over-claim (e.g. a 1.6m chest stays one cell; the ~5m fortress
  spans 5×5).
- `deployPlacementValid(cell, radius, ignoreId?)` rejects a spot if ANY footprint
  cell already holds a terrain block OR overlaps another deployable's footprint at
  the same `y`. The start marker passes `ignoreId = startId` so it can replace
  itself. Invalid placement is a **no-op** click; the ghost turns red.
- Ghost preview spans the whole footprint and is green (valid) / red (invalid) for
  the deploy tool, neutral cyan for the build brush.

**Why:** the editor used to snap feet to `surfaceY` but never checked occupancy,
so assets clipped into terrain and stacked invisibly in one cell.
**How to apply:** validation runs only on user placement, NOT on `load()` — saved
maps stay valid as-is. The build brush is unchanged (one block per cell, replace
on overlap); occupancy is one-directional (deployables avoid blocks, not vice
versa).

## Starting-map templates

Code-defined presets live in `three/voxel/templates.ts` (`MAP_TEMPLATES`,
pure `VoxelMap` data, no THREE/`@workspace` imports). A `VoxelTemplatePicker`
overlay shows on fresh editor entry + via the "New" toolbar button. Every
template MUST include a `start` deployable or Test stays disabled (`hasStart`).
