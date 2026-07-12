# Animator (the "Danger Room")

**Deployed at:** `/animator/` &nbsp;·&nbsp; **Package:** `@workspace/animator-app` &nbsp;·&nbsp; **Engine:** plain three.js

A third-person character **animation + combat studio** set in an X-Men-style
"Danger Room" training chamber. Pick a character and weapon, run around, attack,
and fire signature skills, while live-tuning movement, camera, and combat feel
from an in-app editor.

## What you can do

- **Drive a character** in third-person: camera-relative WASD, jump + double-jump,
  attack, weapon skill (F), four signature skills (1–4), and a Skyfall special (R).
- **Switch characters and weapons** — the default is the procedural **Explorer**;
  others (e.g. the **Striker**, a weaponless kick-fighter) bring their own clips
  and combat style.
- **Tune everything live** — move speed, jump, gravity, camera distance/height,
  FOV, dash distance, AoE radius, knockback, and per-character **attack
  direction-assist + dash rating**.
- **Train against dummies** with impact VFX, dash lunges, and target-assisted
  strikes.

## Run

```
pnpm --filter @workspace/animator-app run dev
pnpm --filter @workspace/animator-app run typecheck
```

## How it's built (three.js, not R3F)

**Plain three.js.** React renders only the HUD and editor panels; the scene is a
hand-written engine.

- `src/three/Studio.ts` — the scene owner: renderer, lights, the Danger Room,
  characters, VFX, skills, and the update loop.
- `src/three/Controller.ts` — the **bespoke third-person camera + movement
  controller** (yaw/pitch orbit, gravity, ground clamp, dash lunges, and a
  wall-clamp that keeps the camera inside the room so walls can't occlude the
  character). This is hand-written three.js, **not** R3F `useFrame`/`<Canvas>`.
- `src/three/DangerRoom.ts` — the training chamber geometry (disposable).
- `src/three/Character.ts` / `ExplorerCharacter.ts` — GLB and procedural rigs
  behind one shared `Avatar` interface the controller/studio drive.
- `src/three/assets.ts`, `types.ts` — character/weapon/skill definitions and
  editor params; `Vfx.ts` — impact/skill effects.
- `src/components/Hud.tsx` — the RPG-style HUD overlay (vitals, action bar with
  cooldowns), fed by snapshots the engine pushes.

## Self-contained by design

This artifact **does not import `@workspace/*` libraries.** The animator library
is ported locally into `src/three/explorer/`, and its FBX animation assets are
hosted in this app's own `public/anim/...` and loaded via `FBXLoader`.

> Combat tuning (direction-assist / dash-rating), the lunge/dash motion model, and
> the locomotion blend are documented in `replit.md` and `.agents/memory/`.
