---
name: Voxel template/editor deployable grounding
description: Why voxel-editor deployables must be authored one cell above the floor, unlike play mode
---

# Voxel deployable grounding: editor vs play

The Voxel **Editor** grounds a deployable (npc/start/bag/prop) via `surfaceY()`,
which rests its feet on the TOP of the block **below** its own cell. So a
deployable authored at the floor's own cell (e.g. cell y=0 on a floor whose
blocks occupy cell 0) has nothing below it → sits at world y=0 → **buried** inside
the floor block (top at world y=1). It looks fine in **play** mode only because
`VoxelArena` spawns at `Math.max(0,d.y)` and physics gravity drops it onto the
floor. Hence "characters floating / not on their feet" reproduces ONLY in the
editor.

**Rule:** author every deployable at `topBlockCell(x,z) + 1`, never at the floor's
own cell. `MapBuilder` (templates.ts) auto-grounds via a per-column height map
(`groundCell`); `start/npc/bag` take optional `y` and default to it.

**Why:** editor and play use different grounding paths; the editor is stricter
(`deployPlacementValid` even forbids interactively placing a deployable in a cell
that has a terrain block), so authored data that violates it shows buried previews.

**Facing:** rigs face +Z at yaw 0, so `yaw = atan2(dx, dz)` aims one entity at
another. NPC/start `yaw` is editor-preview-only — `VoxelArena` ignores npc/start
yaw (NPCs turn via AI at runtime).
