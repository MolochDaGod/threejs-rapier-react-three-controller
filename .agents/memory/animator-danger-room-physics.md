---
name: Danger Room physics + faction NPCs
description: Why the Danger Room has a standalone Rapier physics layer and how empty-boot + faction spawning are kept additive.
---

# Danger Room real physics (D1)

The Danger Room (animator artifact, vanilla three.js, **no @workspace imports**)
gained a renderer-agnostic Rapier physics core as the foundation for a planned
r3f + Rapier rewrite.

- **Rule:** the physics layer (`PhysicsSystem` world wrapper + `PunchingBags`
  body/joint setup) must stay renderer-agnostic — only the per-frame visual
  `sync()` touches three. **Why:** it has to survive the r3f rewrite untouched.
- Rapier wasm must be `init()`-ed once before any world; bring physics up async
  and null-guard the loop (`physics?.step`, `bags?.sync`) so a slow/failed wasm
  or GLB load never hangs the render loop. Dispose bags before freeing the world.
- Hung bags = dynamic body pinned to a fixed ceiling anchor by a SPHERICAL joint
  + heavy linear/angular damping → swing on hit, settle, never drift off-spot.

# Boot roster + faction NPCs

- **Boot roster (current):** the room seeds 3 inert "training dummy" fighters at
  fixed spots (via `targets.spawnAt`) and defaults `Studio.difficulty` to
  **"passive"** so they stand still until the user raises difficulty in the Admin
  panel. **Why:** the user thinks of the visible heavy-bags as lockable; a purely
  decorative mesh that isn't a registered `Targets` fighter is NOT lockable by
  Tab/soft-lock/RMB. Anything you want lockable MUST be a real `Targets` entry.
  (Superseded the older "empty-boot, count default 0, only punching bags"
  invariant — `Targets` constructor `count` still defaults 0; the dummies are
  added on top by `Studio`, not via `setOpponentCount`.)
- NPCs carry a `Faction` (`enemy|ally`): allies hunt enemies, enemies hunt the
  player + allies; player-facing targeting (nearest/raycast/blast/launch) skips
  non-enemies. Spawning is **additive** (`spawn(weaponId,faction)`/`spawnAt(pos,…)`
  /`clear()`); `setCount`/`build` WIPES all dummies incl. the training ones.

# Pointer-lock camera spike (the "tossed to the far wall" jolt)

Mouse-look in `input.ts` integrates raw `e.movementX/Y`. Chrome (and others)
emit ONE bogus, huge movement delta on the first event after pointer lock is
(re)acquired or focus returns; at the look sensitivity that single spike swings
yaw ~180–250°, orbiting the third-person camera across to the opposite wall.

- **Fix/rule:** on `pointerlockchange` to locked, arm a `freshLock` flag + zero
  the accumulators, then DROP the first `mousemove` after lock; also clamp every
  per-event delta to ±120px (real flicks are tens of px/event). Loop dt is
  already clamped to 0.05 so the camera lerp can't snap on a long-frame either.
- **Why:** without dropping the warm-up event the room "instantly throws" the
  view to the far side every time you click to re-enter — a recurring UX bug.
