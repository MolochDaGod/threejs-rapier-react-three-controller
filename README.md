# Animator — 3D Creative & Game Toolkit

A pnpm monorepo focused on a single deployed, browser-based 3D app — **Animator**
— built on **plain [three.js](https://threejs.org)** (no game engine, no React
Three Fiber) with **[Rapier](https://rapier.rs)** physics, plus a small
Node/Express API server kept as a backend.

## Artifacts

| Artifact | Preview path | What it is |
| --- | --- | --- |
| **Animator** | `/` | The flagship: a third-person character animation, camera, combat, physics, and VFX studio (procedural + GLB characters, weapons, skills, a voxel level editor, live tuning). |
| **API Server** | `/api` | Express backend (PostgreSQL + Drizzle, OpenAPI-driven routes). Retained; also holds shared netcode libs. Not a standalone app. |
| **Canvas / mockup-sandbox** | `/__mockup` | Internal component-preview tool that powers the workspace canvas board. Not deployed as a product. |

> History: this repo previously held a voxel Game Studio (`/`), a Voxel Arcade
> game hub (`/arcade/`), and a Carrier multiplayer game. Those were deleted to
> focus entirely on the Animator, which now serves at `/`.

## three.js, not React Three Fiber

Every 3D scene, camera, and controller is hand-written against the three.js API:

- The engine is a **plain disposable TypeScript class** that owns its own
  `THREE.WebGLRenderer`, scene graph, camera rig, and update loop
  (`Studio.ts` / `Controller.ts` in Animator).
- The **camera controllers are bespoke** — custom third-person orbit/follow rigs
  driven by yaw/pitch, gravity, and ground/wall clamping. None go through R3F's
  `<Canvas>` / `useFrame` model.
- **Physics** uses `@dimforge/rapier3d` (loaded via WASM).
- **React is UI only** — menus, HUD overlays, panels. The engine pushes immutable
  snapshot objects to React via callbacks; React renders a pure overlay on the
  `<canvas>`. The engine never touches HUD DOM and React never touches the scene.

## Stack

- **pnpm workspaces**, Node.js 24, TypeScript 5.9
- **3D:** three.js `^0.184` + `@dimforge/rapier3d` physics
- **UI:** React 19 + Vite, radix-ui, framer-motion, `lucide-react`
- **API:** Express 5, PostgreSQL + Drizzle ORM, Zod validation, Orval codegen
- **Build:** Vite (app), esbuild (server)

## Run & operate

Apps run via Replit **workflows**, not root `pnpm dev`. To run or restart one,
use its workflow (or the Replit preview pane):

- `pnpm --filter @workspace/animator-app run dev` — Animator
- `pnpm --filter @workspace/api-server run dev` — API server

Quality gates:

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/animator-app run test` — Animator vitest suite
- `pnpm --filter @workspace/vfx run test` — VFX lib vitest suite

## Repository layout

```
artifacts/
  animator/       # Animator / Danger Room (deployed at /)
  api-server/     # Express API (deployed at /api)
  mockup-sandbox/ # internal component-preview tool (not deployed)
lib/              # shared libraries (animator, vfx, epicfight, db, api-spec, netcode, ...)
```

> `replit.md` holds the deeper architecture notes and agent/contributor
> conventions for the project.
