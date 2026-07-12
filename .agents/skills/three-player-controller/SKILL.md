---
name: three-player-controller
description: Turnkey three.js capsule character controller (walk/run/jump, first/third person, camera obstacle avoidance, flight, optional vehicles) built on three-mesh-bvh, plus a center-screen aim ray for rifle/crossbow/staff aimed shots. Use when adding generic walk-around locomotion or harvesting its aim/camera patterns — NOT for replacing a bespoke combat controller.
---

# three-player-controller

A lightweight, batteries-included player controller for three.js: capsule
collision, locomotion animation, first/third-person switching, spring camera with
obstacle avoidance, optional flight and (Rapier-backed) vehicles. Collision is
accelerated by `three-mesh-bvh` (its own skill), so it scales to large scenes.

> Repo: https://github.com/hh-hang/three-player-controller
> Aimed-shot reference (rifle / crossbow / staff):
> https://hh-hang.github.io/three-player-controller/shooting/shooting.html

## When to use it in the Animator (read first)

The Animator already has a **deeply bespoke** `src/three/Controller.ts`:
target-lock, combat lunges (dash/skyLaunch/backflip), dodge-roll, mech mode,
combos, blink, plus a pluggable `CollisionProvider` seam. That controller is the
product. **Do not wholesale-replace it with this library** — three-player-controller
is a generic locomotion/flight/vehicle controller with no concept of combat, and
swapping it in would throw away target-lock, lunges, dash, mech, dodge-roll, and
the combo system.

Use this library for:

- **New, generic walk-around contexts** — an exploration/tour mode, a vehicle or
  flight sandbox, a quick playground where bespoke combat is not needed.
- **Harvesting patterns** into the existing engine — camera obstacle avoidance,
  the spring camera, and especially the **center-screen aim ray** for ranged
  weapons. The Animator's `AimSystem.screenCenterRay` already mirrors this
  library's `getCenterScreenRaycastHit()`; align the two rather than running both.

It is a capsule controller; for true rigid-body/vehicle physics it can use Rapier,
which the Animator already depends on.

## Install

```bash
# Core (three-mesh-bvh is a hard dependency)
pnpm --filter @workspace/animator-app add three-player-controller three-mesh-bvh
# Optional — only if you use the vehicle feature:
pnpm --filter @workspace/animator-app add @dimforge/rapier3d-compat
```

The Animator already has `three`, `three-mesh-bvh` (see that skill), and
`@dimforge/rapier3d-compat`, so a new controller context reuses them.

## Quick Start

```ts
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { playerController } from "three-player-controller";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
const controls = new OrbitControls(camera, renderer.domElement);

const player = new playerController();
await player.init({
  scene,
  camera,
  controls, // the controller TAKES OVER this camera control
  playerModelConfig: {
    url: "./glb/person.glb",
    scale: 0.001,
    idleAnim: "idle",
    walkAnim: "walk",
    runAnim: "run",
    jumpAnim: "jump", // or ["takeoff", "loop", "land"] for a 3-phase jump
  },
  initPos: new THREE.Vector3(0, 0, 0),
});

function animate() {
  requestAnimationFrame(animate);
  player.update(); // drives movement, animation, AND the camera
  renderer.render(scene, camera);
}
animate();
```

**Critical:** `player.update()` internally drives the supplied camera controller.
Do **not** also call `controls.update()` in your loop — the two will fight. This is
the main integration gotcha and conflicts with how the Animator's `Studio` loop
currently owns the camera, so a new context must hand the camera to the player.

## Collision model

The controller builds a **merged collider mesh** from the scene's static geometry
and accelerates it with three-mesh-bvh; the player is a capsule resolved against
it each frame. Query helpers:

- `getCollider()` — the merged collider mesh used for BVH checks.
- `getActiveDynamicCollider()` — the dynamic collider the player stands on (moving
  platforms), or `null`.

To collide against static level geometry, make sure it is in the scene before
`init()` (or rebuild the collider when the level changes — see the API).

## Aimed shots (rifle / crossbow / staff)

The shooting demo is built around a **center-screen raycast** plus first-person
aiming and aiming locomotion sets — exactly the model the Animator's combat aim
already uses.

```ts
// Per frame (or on fire): what the crosshair is pointing at.
const hit = player.getCenterScreenRaycastHit();
if (hit) {
  // hit.point / hit.object / hit.distance — spawn projectile toward hit.point,
  // orient muzzle flash / decal to the surface, apply damage by zone, etc.
}
```

Pair this with first-person mode and a weapon-specific locomotion set so movement
animations match the equipped weapon:

```ts
player.registerLocomotionSet("rifle", {
  idle: "RifleIdle",
  walking: "RifleWalk",
  walking_backward: "RifleWalkBack",
  running: "RifleRun",
});
// switch sets when the weapon changes; omitted keys keep the built-in clip.
```

For the Animator specifically: the bespoke ranged weapons (bow, magic/staff,
gunblade, etc.) should keep flowing through `AimSystem` + the weapon-class system
(see the `animator-*` memory). This library's shooting demo is a **reference** for
the center-screen aim + aiming-stance pattern, and three-mesh-bvh (its own skill)
is the piece worth adopting to accelerate those existing aim rays.

## Key API

| Call | Purpose |
| --- | --- |
| `new playerController()` / `await player.init(opts)` | Construct and load the rig + collider. |
| `player.update()` | Per-frame: movement, animation, camera (don't also call `controls.update()`). |
| `player.loadVehicleModel(opts)` | Optional Rapier vehicle (wheels, boarding point). |
| `player.getCenterScreenRaycastHit()` | Center-screen aim ray result — rifle/crossbow/staff aiming, interaction. |
| `player.getCollider()` / `getActiveDynamicCollider()` | The BVH collider / current dynamic ground. |
| `player.registerAnimation(key, clip, opts)` | Register a one-off clip (loop, timeScale, duration, onFinished). |
| `player.playAnimation(key, opts)` | Play a registered clip (fade, force, returnToPrev). |
| `player.registerLocomotionSet(name, clips)` | Swap the idle/walk/run/jump/fly set (e.g. per weapon). |
| `player.setInput(input)` | Feed custom input (gamepad / your own key state). |
| `player.setKeyMap(map?)` | Rebind keys at runtime; omit arg to restore defaults. |
| `player.setPlayerScale/Speed/FlySpeed/JumpHeight/Gravity(v)` | Runtime tuning. |
| `player.setMinCamDistance/MaxCamDistance/ThirdMouseMode(v)` | Third-person camera tuning. |

Default keys: WASD/arrows move, Shift sprint, Space jump, `V` toggle view, `F`
toggle flight, `E` enter/exit vehicle — all rebindable via `keyMap` / `setKeyMap`.
Note these defaults collide with the Animator's existing key bindings (e.g. `F`,
`V`, `E` are used elsewhere), so remap before use in any shared context.

## Pitfalls

- **Double camera update** — calling `controls.update()` alongside `player.update()`
  causes camera jitter/fighting. Let the controller own the camera.
- **Not a combat controller** — no target-lock, lunges, dash, dodge, combos, or
  mech. Don't expect to drop it in over `Controller.ts`.
- **Default keymap clashes** — remap `F`/`V`/`E`/Shift to avoid the Animator's
  engine keys before mounting.
- **Collider freshness** — static geometry must exist at `init()` (or rebuild the
  collider) or the player walks through it.
- **Single `three` instance** — like three-mesh-bvh, keep `three` deduped in Vite.

Verify any adoption with `pnpm --filter @workspace/animator-app run typecheck`
(not `build`, which needs workflow-provided `PORT`/`BASE_PATH`).
