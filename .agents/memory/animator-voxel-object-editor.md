---
name: Voxel Editor object editor (Select / gizmo / hierarchy)
description: How the Select tool, TransformControls gizmo, and hierarchy panel work in the Animator Voxel Editor, and the scale-composition invariant.
---

The Voxel Editor has a Select tool (EditorTool "select") that attaches a three.js
TransformControls gizmo (translate/rotate/scale) to DEPLOYABLES only (NPCs, heavy/
physics bags, props, player start). Blocks stay grid-locked and are never selectable.

**Scale-composition invariant (the subtle part):**
`DeployableData.scale` is a PURE user multiplier (defaults to 1). Play mode
(VoxelArena) renders NPCs at `DIFFICULTY_SCALE[tier] * scale`. So the editor must
preview the same composite or what-you-see ≠ what-you-play.

- `deployBaseScale(data)` returns the non-user portion: difficulty scale for an
  NPC in dungeon mode, else 1.
- `applyDeployTransform` / `applyNpcDifficultyScale` set the group scale to
  `deployBaseScale(data) * (data.scale ?? 1)`.
- The gizmo edits the COMPOSITE group scale, so `writeBackTransform` divides the
  base back out (`data.scale = group.scale.x / base`) to keep `data.scale` pure.
- `duplicateSelected` must copy from `d.data` (synced on drag-end by
  writeBackTransform), NOT re-read `group.scale.x`, or it double-counts the base.

**Why:** an earlier pass overwrote group scale with bare `data.scale`, wiping
difficulty scaling from the NPC preview and breaking the editor↔play round-trip.

**State sync:** `clearAll()` (also called by `load()`) MUST reset selection:
null `selectedId`, `gizmo.detach()`, `onSelect(null)` — otherwise the gizmo dangles
on a removed group. Selection state mirrors React via onTree/onSelect/onGizmoMode.

**How to apply:** any new transformable deployable kind or new difficulty-like
auto-scaling must go through `deployBaseScale` on BOTH the editor apply and the
writeback divide, and match VoxelArena's play-mode scale formula.
