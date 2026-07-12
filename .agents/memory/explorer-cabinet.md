---
name: Explorer cabinet (third-person GLB roam)
description: Non-obvious pitfalls when loading premade GLB maps and doing ground-follow movement in the arcade Explorer cabinet.
---

# Explorer cabinet

A scoreless third-person walking sandbox in `artifacts/arcade`: pick a premade
voxel GLB map, customise a procedural box avatar, roam with gravity + ground
raycast. Same disposable-engine + pure-HUD pattern as the other cabinets, but it
owns a pre-game setup screen + async map load in its launcher (not the shared
Play engine effect — Play.tsx early-returns to `ExplorerLauncher` and never marks
explorer as a zombie/boat session).

## Ground raycast must originate just above the player, not from the sky
Casting the downward ground ray from a high fixed Y (e.g. map footprint) and
taking `hits[0]` snaps the avatar to the **top-most** surface at (x,z) — roofs,
tree canopies, bridges — which pops it upward under any overhang.
**How to apply:** cast from `player.y + smallLift` downward; the nearest hit is
then the ground actually under the player. Only use a sky-high origin for the
initial spawn sample where top surface is fine.

## Dispose GLTF scenes that resolve after teardown
`GLTFLoader.loadAsync(...).then(gltf => ...)` can resolve **after** the effect
cleanup ran (map change, unmount, or React StrictMode double-invoke). If the
engine never takes ownership in that branch, the GLB geometry/materials/textures
leak.
**Why:** large maps here are tens of MB; leaking one per cancelled load is real.
**How to apply:** in the resolve handler, if `cancelled`/container gone, call
`disposeObject3D(gltf.scene)` before returning.

## Ranged fire is host-spawned, timed to the attack clip — not the recoil
The animator only plays bow/rifle aim/draw/recoil poses; it never spawns
anything. The host engine fires by calling `animator.attack()` (returns the
clip duration), scheduling the projectile to leave at `dur * releaseFraction`,
then owning + advancing the entity itself (forward sweep-raycast vs `collMeshes`
for impact, lifetime fallback) and disposing it via `disposeObject3D`.
**Why:** keeps the animator a pure pose driver with no world/entity knowledge;
timing to the draw clip is simpler + more robust than hooking the `aim(false)`
recoil one-shot. Travel direction is sampled at spawn, not at keypress, so a
late aim nudge still aims the shot.

## Swim is only reachable if the void is a real water VOLUME, not a flat plane
Maps normalise their lowest point to y=0 and a safety plane also sits at y=0, so
"deep water" and "low dry land" are the SAME height — a depth-based swim trigger
(ground far below the surface) can never fire, and the footprint clamp
(`halfBounds = footprint/2`) pins the avatar onto the terrain so it never even
reaches open space.
**Why:** the GLB maps contain no water geometry; height alone can't distinguish
water from low ground, and the clamp hides the only place that could be water.
**How to apply:** sink the safety/ground plane to a `voidFloor` well below 0,
put the water surface at sea level (`waterLevel = 0`), draw a translucent water
plane there (NOT in `collMeshes` — the ground ray must pass through it to hit the
basin floor), and widen `halfBounds` to the plane extent so the avatar can walk
off the shore into the surrounding sea. Then "ground far below surface" reliably
means water, terrain (y>=0) never false-triggers, and the exit margin gives
shoreline hysteresis. (Per-map real water bodies are the richer follow-up.)

## Traversal modes/one-shots must be guarded on EVERY input path
Mantle/climb/swim take over the body; if an action can still fire it interrupts
the traversal animation. Guarding only the keyboard handler leaves the gamepad
poll (`pollGamepad`) able to trigger attack/roll/dash/weapon-cycle/aim mid-climb.
**How to apply:** gate every action source on `climbing || swimming || mantleState`
(and force holds off), not just keyboard — mirror the guard in the pad poll.

## Animation GAIT must be decoupled from the translation ramp
The smoothed move intensity (`locoSpeed`) does double duty: it ramps actual
travel speed AND was fed straight to the animator as the idle->walk->run blend
`speed`. Keyboard input magnitude is BINARY (a unit move vector ~= 1), so any
`Math.max(inputMag, ...)` floor pins it to 1.0 every step → the avatar is stuck
in the full RUN/"charge" clip and never shows a walk (and a near-idle stance can
read as a crouched "sneak" since there's no walk in between).
**How to apply:** keep `locoSpeed` as the 0..1 translation ramp (target
`min(inputMag,1)`, reaches full speed walking or sprinting), and derive a SEPARATE
gait = `locoSpeed * (running ? 1 : WALK_GAIT≈0.45)` for `setLocomotion({speed})`
and for sprint FOV / moving-attack intensity. Walk caps in the blend's walk tier;
Shift/stick-sprint opens the run tier. Translation speed itself stays governed by
walkSpeed/runSpeed, unchanged.

## Pointer-lock re-acquire has a browser cooldown; swallow the rejection
`requestPointerLock()` rejects ("cannot be acquired immediately after exiting")
for a short period after an exit, and surfaces as an UNHANDLED rejection if not
caught. Chrome 113+ returns a promise; older browsers return undefined + fire a
`pointerlockerror` event; it can also throw synchronously when not user-gestured.
**How to apply:** wrap as `try { void Promise.resolve(el.requestPointerLock?.())
.catch(()=>{}) } catch {}` — covers all three shapes. Re-lock must run inside a
user gesture; on cooldown failure just leave the cursor free (player clicks to
re-capture). Pointer-lock + Puter guest auth both block headless tests → verify
mouse-look manually.

## Airborne ability state is one machine; reset it on EVERY ground touch
Double-jump flip, post-flip slow-fall, and the melee dive-slam share four fields
(`jumpsUsed`, `slowFallTimer`, `slamming`, `fallLoopActive`). The single jump
entry point is `requestJump()` (keyboard Space + gamepad A both call it):
grounded→takeoff (jumpsUsed=1), mid-air & jumps left→climb-probe-then-flip
(+slow-fall), jumps spent→last-chance flush wall grab only. Climb is probed
BEFORE the flip so a wall within ~1 block wins. Slam (`triggerSlam`) drives velY
hard negative + holds the pose; impact fires `vfx.shockwave` + the public `onSlam`
hook (no damage — that's a future combat task).
**Why:** if any one ground-contact path forgets to zero these, the next jump
mis-counts (e.g. no second jump, or a stuck slow-fall). Both the landing branch
AND climb-entry reset all four.
**How to apply:** keep ONE reset block; the airborne fall-loop is re-armed each
frame only when `!grounded && !slamming && !fallLoopActive && !animator.isBusy()`
so a finished one-shot (flip) falls back to the loop without re-triggering.

## Settings are device-local (localStorage), never in the world/account save
`game/settings.ts` is a separate singleton store from the RPG `game` store
(`useSyncExternalStore`, clamps numerics to exported `*_RANGE`s, schema-versioned).
The launcher applies them to each fresh engine (`engine.applySettings`) AND
subscribes to push live edits. `baseFov` field must be typed `: number` — it
seeds from `CONFIG.camera.fov` (a literal) so inference would pin it to `60`.
**Why:** invert-Y/sensitivity/FOV/cam-distance are per-device, not per-character.

## Other notes
- Maps are authored at wildly different scales — normalise each to a target
  horizontal footprint (uniform scale by `footprint / max(size.x,size.z)`), then
  centre on origin and rest `box.min.y` on y=0 so a safety ground plane lines up.
- Per-frame `intersectObjects` over a heavy GLB is a frame-time hotspot; throttle
  the ground sample (every N frames) since there is no BVH lib installed.
- The ~390MB viking-island GLB was omitted as too heavy for the browser.

## Sword & Knife (Digit3) orbiting-dagger ring

A two-stage ability on the Explorer cabinet. Each of the 8 orbiting blades OWNS
its own geometry+material (not shared) so a blade can `shift()` out of the ring
and be handed to the projectile system as a "dagger" — `removeProjectile` then
`disposeObject3D`s it safely with no double-free. `clearDaggerRing` only frees
blades still orbiting (fired ones have already left the array).

**Why:** sharing geo/material across ring blades would make projectile disposal
free a still-orbiting blade's GPU buffers (use-after-free / flicker).

**How to apply:** any "pool that converts members into projectiles" pattern must
give each pool member its own disposable resources and remove-before-fire, never
dispose in the pool teardown what's already been transferred out.

- Ring teardown must be unified across EVERY weapon swap path: keyboard Digit
  swap AND gamepad `cycleWeapon` both call `cancelDaggerAbility()` (cancel pending
  arm + dissolve active ring + restore offhand). Wiring only the keyboard path
  leaves the ring stuck across a gamepad swap.
- Ring arms on the Frisbee Throw clip's FULL duration (spec: "pops at clip end"),
  with a fixed fallback delay when the clip fails to load.
