---
name: Voxel streaming integrity
description: How the voxel player is kept from falling through unloaded terrain / off the world edge during streaming.
---
# Voxel streaming terrain integrity

`World.getVoxel` returns AIR for unloaded chunks, which is indistinguishable
from genuine empty air — so collision used to let the player drop straight
through a region whose chunk hadn't streamed in yet (and off the edge of the
finite world).

The rule: the **player body** treats not-yet-loaded space as solid.
`World.isChunkLoadedAtVoxel(wx,wy,wz)` answers "is this chunk present", and
`boxCollides`/`moveAABB` take a `solidIfUnloaded` flag (default false). Controls'
walk/climb/swim pass `true`; the body is held at the load/world frontier instead
of falling into the void, then resumes normal gravity once the real chunk
arrives and lands on the true surface.

**Why default false:** mobs (`CreatureSystem`) and projectiles reuse `moveAABB`
and must behave normally against loaded geometry only — only the player wants the
frontier-as-wall behaviour.

**How to apply:** keep this flag player-only. It must stay deterministic (no
time/randomness) so terrain determinism tests remain valid. Restore is already
gated on `Engine.isGenerating===false`; this guard is the second line of defense.
Initial/regenerate streaming is hidden by the opaque `LoadingScreen` overlay
(solid bg + full-bleed GIF), and the worker meshes every chunk with full
neighbour awareness (inserted via `addChunkSilent`, dirty=false) so finished
terrain has no seams.
