---
name: Animator Danger Room Voxel Editor
description: The second "door" in the animator artifact — a self-contained voxel map editor; how its engine/UI/mode-routing is wired and what is intentionally NOT simulated.
---

# Danger Room Voxel Editor (animator artifact)

> **Update:** authored maps are now PLAYABLE. `Mode` adds `"play"`; the editor's
> "Test" button (gated on a placed Player Start) serializes+saves the map, mounts
> a fresh `Studio`, and on character-load calls `Studio.enterArena(map)`. The
> `VoxelArena` (`src/three/voxel/VoxelArena.ts`) mirrors `Dungeon.ts`'s
> collision-bake + KCC `CollisionProvider` pattern but KEEPS the Danger Room
> floor/atmosphere visible (the map sits on the y=0 plane) and REUSES the live
> `Targets` population via `spawnAt()` rather than stashing it — because exiting
> play disposes the whole Studio, so there's nothing to restore. NPCs spawn armed
> (ranged downgraded to sword — melee-only AI) and difficulty-scaled via
> `DIFFICULTY_HEALTH`/`DIFFICULTY_DAMAGE`/`DIFFICULTY_SCALE` (tier only honored
> when the map's `dungeon` flag is set, else "normal"). Physics bags react to hits
> through `Targets`-style `blastBags`; heavy bags are static colliders. Exit
> restores the map into the editor via a `cameFromPlay` ref + `playMapRef`.

The animator artifact (`@workspace/animator-app`, preview `/animator/`) has a
facility-entrance door screen that routes between two disposable engines, NOT a
single auto-mounted one.

- **Mode routing lives in `App.tsx`**: `Mode = "doors" | "danger" | "voxel"`.
  Each engine has its own `useEffect` gated on `mode` (mount on enter, dispose on
  leave). `mode === "doors"` early-returns `<DoorSelect/>` and mounts no engine.
  The old behaviour (Studio auto-mounts on load) is gone — combat is now behind a
  door. Danger-mode keyboard shortcuts + touch effects are also gated on mode.
- **Editor engine**: `src/three/voxel/VoxelEditor.ts` — same disposable
  constructor/`dispose()` pattern as `Studio`. CAD orbit camera (spherical around
  a `target`): LMB-click places, RMB-click erases, drag orbits (a movement
  threshold distinguishes click vs drag so one button does both), wheel zooms,
  middle/Shift-drag + WASD pan, `R` rotates the brush. Reuses `DangerRoom` for the
  environment. Grid ±24 cells, max height 32.
- **Shared cache discipline** (same rule as `three-disposal.md`): block +
  deployable meshes reference geometries/materials from `geoCache`/`matCache`;
  removing a placed mesh only detaches it (no per-instance dispose). Everything is
  disposed once in `dispose()`. Ramp pieces use a custom triangular-prism
  BufferGeometry + a DoubleSide material variant.
- **What is NOT simulated**: this is an author-only editor. Deployables (armed
  NPCs per `WeaponId`, static heavy bags, black physics-bag cylinders, a single
  player-start marker) are placed *data* with visual proxies — no AI, combat, or
  physics runs in the editor. "Custom dungeon" mode just tags NPCs with a
  difficulty tier (ring colour + body scale) and saves it. Actually *playing* a
  built dungeon is a deliberate future task that would consume the saved map.
- **Persistence**: `serialize()/load()` round-trip a `VoxelMap` (version-stamped);
  Save/Load buttons hit `localStorage["dangerroom:voxelmap"]`. No KV/server — the
  artifact stays self-contained (forbids `@workspace/*` imports).
- **UI**: `components/DoorSelect.tsx` (entrance) + `components/VoxelEditorUI.tsx`
  (top bar with dungeon toggle + save/load/clear/exit, left palette panel with
  Build/Deploy tabs, bottom stats). Styles appended to `index.css` under the
  `Door select` / `Voxel editor UI` banners, matching the existing
  `--accent`-blue HUD look (no shadcn theme tokens defined here).
- **Verification**: no WebGL in the Replit screenshot sandbox, so the editor
  itself is manual-verify only; the DOM door screen does screenshot fine. Rely on
  `pnpm --filter @workspace/animator-app run typecheck` + proxy 200.
