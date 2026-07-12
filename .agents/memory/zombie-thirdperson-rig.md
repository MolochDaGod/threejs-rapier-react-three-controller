---
name: Zombie cabinet third-person rig
description: Non-obvious facts about the bbmodel GLB rig and the third-person camera/aim convention in the arcade zombie game.
---

# bbmodel GLB rig is skinless

The arcade player/teammate/enemy GLB is a Blockbench export with **0 skins** —
its animation clips drive **node (Object3D) transforms**, not skinned bones.

**Why it matters:** weapons must be attached to a *node* (the built-in gun node,
not a skeleton bone) and that node is also the thing you hide to swap in a catalog
weapon. `SkeletonUtils.clone` preserves node names, so node lookup by name works
on clones. Hand-anchor / hide-node names live in `assets.ts`
(`HAND_ANCHORS`, `HIDE_BUILTIN_WEAPON`); the universal `AnimatedActor`
(`games/shared/three.ts`) resolves clips by regex pattern with fallbacks because
clip names differ per archetype (player vs enemy vs teammate).

# Third-person camera + aim convention

- `camYaw` is the single source of truth for the orbit angle, the player's
  facing, **and** movement. Horizontal forward = `(sin camYaw, 0, cos camYaw)`;
  screen-right = `cross(forward, up)`. WASD is built from these (camera-relative).
- The player's **body** faces the `camYaw` forward azimuth directly (squares the
  back to the camera for a clean behind/over-the-shoulder view). Do NOT face the
  body at the centre-screen floor hit — the shoulder offset skews that and the
  body reads side-on.
- **The bbmodel FPS rig (player + teammate variants) is authored facing local -Z**,
  the OPPOSITE of the Synty enemy models (+Z). The global `MODEL_YAW` half-turn is
  correct for the +Z enemies but flips the FPS rig backwards (front-to-camera), so
  `MODEL_YAW_BY_VARIANT.normal`/`.teammate` must CANCEL it (`MODEL_YAW + Math.PI`).
  Enemies keep the plain `MODEL_YAW`. Symptom of getting it wrong: the player shows
  its chest to the camera and the ally moonwalks toward enemies.
- **Aim is decoupled from facing.** Projectiles converge on the centre-screen
  reticle: `computeAimPoint()` casts the centre-screen ray against an eye-level
  plane (`CAMERA.aimPlaneHeight`, far-ray fallback); shots spawn from `playerMuzzle()` and fly along
  `aimPoint - muzzle` (a 3D dir passed to `spawnBullet` as `dirOverride`). Without
  this, flat `dir.y=0` shots make the tracer read as a line, not a crosshair.
  Enemy/teammate shots still use the flat yaw-angle path. The HUD owns the centred
  reticle (`ZombieHud.tsx`, hidden on game over).
- Pointer-lock mouse-look: `camYaw -= movementX * sens`, `camPitch += movementY *
  sens` (clamped) → mouse-down looks down.

**Why it matters:** keep movement + body facing on `camYaw`, but route *aiming*
through the reticle raycast — conflating the two is what made the camera look
side-on and the shots look like a line.

# Cosmetic model yaw must NOT feed gameplay direction

`MODEL_YAW_BY_VARIANT.normal` is a *cosmetic* body rotation (e.g. a deliberate
turn-right offset for framing). Any player gameplay direction — melee forward,
`playerMuzzle()` forward, aim — must derive from `camYaw` (`cameraForward()`),
**never** from `this.player.getWorldDirection()`. `getWorldDirection` reads the
model's visual rotation, so it silently couples a cosmetic turn into where hits/
shots land (rotate the model and your melee/muzzle drift sideways). Teammate
muzzle logic intentionally still uses its own facing — leave it.

# The bbmodel rig carries an in-model crosshair quad

The player/ally rig has a node `crosshair_148` (flat ~0.56 quad, child mesh
`Object_258`) authored as an in-model reticle. Left visible it renders as a stray
**grey square** floating ahead of BOTH player and ally. Hide it via
`HIDE_BUILTIN_WEAPON` (mesh-descendant visibility mask, keeps the node so anim is
fine). The real screen-centre aim indicator is a procedural soft light-circle
reticle (`createCrosshairReticle` in `factory.ts`: radial-gradient ring texture,
additive, `depthTest:false`) that `rebuildCrosshairMarker` builds by default and
`updateCrosshairMarker` glues to `computeAimPoint()` each frame; it builds on init
because the constructor calls `switchWeapon("sword")` → `rebuildCrosshairMarker`.
The dev node-clone override path stays, with a fallback to the soft reticle if a
saved `devConfig.crosshair.nodeName` no longer resolves.

# Weapon grip frame (seating catalog weapons in the hand)

The built-in glock mesh (child of node `glock_93`) is the **ground-truth seating
reference**: a catalog weapon attached to `glock_93` and posed like the built-in
glock in its bind frame will ride the hand and aim correctly once the
armed/shoot/swing clips play (both are children of the same node, so the clips
apply equally). Match the built-in glock, NOT the runtime aim direction.

Measured in `glock_93`'s LOCAL frame (from the actual model bboxes):
- built-in glock: barrel along **+X**, up **+Y**, bbox center ~`[0.3,-0.07,0]`.
- catalog guns (gun-a/assaultriffle/shotgun/heavyweapon FBX): barrel along **+Z**,
  up **+Y**, geometry centered at origin → need a **+90° yaw (Ry)** so the barrel
  lands on the hand's +X, plus a forward (+X) offset so the grip (not the mid)
  sits on the hand.
- catalog sword (`sword-diamond.gltf`): blade along **+Y**, handle at the -Y end →
  needs a **-90° roll (Rz)** so the blade leads forward like the gun barrel.

Because guns need a yaw and the sword needs a roll, GRIP MUST be per-weapon
(`GRIP.firearm` vs `GRIP.sword` in `definitions.ts`); a single shared transform
can't seat both. The grip offset/rotation are in node-local units, comparable to
the built-in glock's local bbox above.

To re-measure model geometry headlessly (no GPU): run a node script that stubs
`global.self/window/document/navigator/createImageBitmap/ProgressEvent`, then
`GLTFLoader`/`FBXLoader` `.parse(arrayBuffer)` (avoids fetch) and compute each
mesh's bbox in a node's local frame. The code_execution sandbox can't reach the
module realm's globals, so use a real `node` script via bash.

# Manual-tuning caveat

Grip offset/rotation (`GRIP` in `definitions.ts`) and camera framing
(`CAMERA.*`) were set blind — they need on-screen tuning with a GPU. Pointer-lock
+ cross-origin Puter guest auth means the game view can't be driven by headless
screenshots; verify it manually in the preview.
