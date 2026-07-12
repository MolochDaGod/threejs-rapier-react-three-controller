---
name: Voxel player physics collision
description: Rules for VoxelPhysics moveAABB/boxCollides so collisions line up with rendered block edges, never tunnel, and rest flush.
---

# Voxel player physics (VoxelPhysics.ts + Controls walk/climb)

The collision core must stay pure-data and deterministic (no randomness, no
wall-clock), integer-cell aligned (1m voxels). Player body AABB is hx/hz 0.3,
hy 0.9 (0.6 wide, 1.8 tall), eye at body.y + 0.7.

## Non-negotiable rules

- **Max-face epsilon, min-face none.** Cell `n` spans `[n, n+1)`. A box MAX face
  exactly on integer `n` only touches cell `n`, it does not overlap it — so
  `boxCollides` floors max bounds as `floor(face - EDGE_EPS)` and min bounds as
  plain `floor(face)`. Without the epsilon the body hits an "invisible wall" one
  cell early. **Why:** discrete floor() over-includes the next cell at exact
  boundaries; this is the root of phantom collisions.
- **Swept resolution, not all-or-nothing.** Each axis bisects to settle flush
  against the surface (fixed step count = deterministic). All-or-nothing per-axis
  leaves the body floating up to a frame's fall distance above ground and
  stopping short of walls.
- **Substep fast moves.** A move longer than ~0.45m on any axis is split into
  equal substeps before resolving. **Why:** the per-axis sweep only checks the
  endpoint, so a fast body (long fall) would tunnel through a thin block if the
  start and end both clear it. Keep the cap well under the 0.6m body / 1m cell.
- **Transparent ≠ solid for collision.** boxCollides requires `isSolid &&
  !isTransparent`, so water (solid:true, transparent:true) never collides.
- **Step-up is opt-in (walk only).** moveAABB takes `stepHeight` (default 0;
  climb/swim/CreatureSystem keep 0). Step-up only fires when a horizontal move is
  blocked, `dy <= 0`, a ground probe just below is solid, and there's headroom —
  then it lifts, retries horizontal, settles down, and **undoes if no progress**.
  This gates it so it can't become free wall-scaling: one block clears, two
  blocks stay blocked.

## Climb / mantle (Controls.ts)

- `wallAt` samples the front face at centre ±half-width (3 points) at reach
  `hx + CLIMB_REACH`, not a single point — a single probe detaches on small
  turns/shimmies.
- Mantle is a velocity launch (`MANTLE_LAUNCH`) + `onGround=false`, NOT an
  instant `body.y += 1.1` teleport — gravity + held-forward + walk step-up carry
  the body over smoothly.

Tests live in `VoxelPhysics.test.ts` (boundary no-phantom, tunneling guard,
flush rest, step-up 1-block yes / 2-block no, determinism).
