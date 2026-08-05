# Animation wiring audit (honest)

Generated: 2026-08-03T18:06:58.974Z

## The uncomfortable truth

| Fact | Count |
|------|------:|
| Total catalog rows | 325 |
| Explorer files on disk | 294 |
| Unique paths referenced in clipCatalog wiring tables | 263 |
| **On disk but NOT wired** (orphan) | **26** |
| Wired + loads OK (duration measured) | 262 |
| Wired but load fails / empty | 6 |
| Wired missing file | 0 |
| grudge6 CDN OK (if --cdn) | 28 |
| Rows with length_sec filled | 311 |

### What “wired” means

A clip is **wired** only if it appears in one of:

- `WEAPON_SETS[weapon].loco` or `.actions`
- `UNIVERSAL_LOCO` / `UNIVERSAL_MOVEMENT`
- `GLOBAL_ACTIONS` / `GLOBAL_REACTIONS`
- `TRAVERSAL_SETS`
- `GLB_CLIP_IDS` / GLB subclips (virtual slices of melee-combo-1)

**Folder name is NOT a connection.** Putting a file under `public/anim/animations/pistol/` does not attach it to the pistol class until `clipCatalog.ts` references that id.

### Hip / XZ honesty

- `pipeline_locked_if_played` = when Animator/GrudgeAvatar plays the clip, root hip position tracks are locked to bind. **Not** a measured Box3 pass.
- `not_played_unverified` = orphan / never bound — **never gets hip lock because it never plays**.
- We have **not** marked measured_pass unless a future ground audit runs.

### Orphan files on disk (not in any wiring table)

- `animations/extra/hip-hop-dancing` (?s) — other
- `animations/greatsword/draw-great-sword-2` (?s) — weapon_handling
- `animations/greatsword/great-sword-blocking` (?s) — defense
- `animations/magic/standing-2h-magic-area-attack-01` (?s) — attack
- `animations/reactions/knocked-out` (?s) — reaction
- `animations/block/parry` (0.5s) — defense
- `animations/bow/standing-melee-kick` (1.4333s) — attack
- `animations/climb/climbing` (3.8333s) — acrobatics
- `animations/extra/crouched-to-sprinting` (0.5s) — locomotion
- `animations/extra/frisbee-throw` (3.3s) — utility
- `animations/extra/male-dynamic-pose` (0.0333s) — other
- `animations/extra/pushing` (1.3333s) — other
- `animations/extra/start-swinging` (2.0333s) — other
- `animations/pistol/jump` (2s) — acrobatics
- `animations/pistol/jump-2` (0.8s) — acrobatics
- `animations/pistol/kneel-to-stand` (1.3667s) — idle
- `animations/pistol/run-backward-arc-left` (0.5s) — locomotion
- `animations/pistol/run-backward-arc-right` (0.5s) — locomotion
- `animations/pistol/stand-to-kneel` (1s) — idle
- `animations/pistol/strafe-left` (0.5667s) — locomotion
- `animations/pistol/strafe-right` (0.6s) — locomotion
- `animations/pistol/walk-backward-arc-left` (0.6s) — locomotion
- `animations/pistol/walk-backward-arc-right` (0.6s) — locomotion
- `animations/rifle/idle-aiming` (2.1s) — idle
- `animations/striker/Flip_Kick` (2.8s) — attack
- `animations/sword/slash-advance` (2.5s) — attack

### Broken / special wiring

| ID | Issue |
|----|--------|
| `animations/combo/melee-combo-1-hit1/2/3` | Virtual slices of `melee-combo-1.glb` — no standalone FBX (OK if parent loads) |
| Known FBX parse fails (historical) | `draw-great-sword-2`, `standing-2h-magic-area-attack-01` |

## CSV

| File | Role |
|------|------|
| `ANIMATION_CATALOG.csv` | Inventory (compat) |
| **`ANIMATION_CATALOG2.csv`** | **Controller registry** — gates, cache keys, loop, preload |

Columns include **wired_connections** (exact weapon:action keys) and **verified_for_use** (no soft lies).  
Controller agents must read **CATALOG2** for `controller_status` / `DO_NOT_LOAD` / shared cache keys.

## Regenerate

```bash
cd artifacts/animator
node scripts/build-anim-catalog.mjs --cdn     # full durations + CDN
node scripts/build-anim-catalog.mjs --skip-fbx  # wiring only (fast)
```
