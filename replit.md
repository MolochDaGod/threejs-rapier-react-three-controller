# Animator — 3D Creative & Game Toolkit

A browser-based 3D character animation, camera, editor, physics, and effects
studio built on Three.js + Rapier. Repositioned as the project's single flagship
app: an extensible resource and AI-assisted tool for building game/3D feel —
movement, camera, combat, VFX, and level authoring — in a live, interactive
sandbox.

## Run & Operate

- Animator (flagship web app) is served at `/` — run via its workflow, not `pnpm dev` at root.
- `pnpm --filter @workspace/animator-app run dev` — run the Animator dev server
- `pnpm --filter @workspace/animator-app run typecheck` — typecheck the Animator app
- `pnpm --filter @workspace/animator-app run test` — Animator vitest suite
- `pnpm --filter @workspace/vfx --filter @workspace/carrier-net --filter @workspace/danger-net --filter @workspace/epicfight run test` — shared-lib test suites (the project's `test` validation/CI check)
- `pnpm --filter @workspace/api-server run dev` — run the API server (retained backend)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env (api-server only): `DATABASE_URL` — Postgres connection string

### Game server hosting (Railway)

The realtime game backend (space/carrier/danger WebSocket relays) runs as a
dedicated always-on service on Railway — **separate** from the api-server and from
the Replit web deployment. It serves `wss` over an auto-TLS domain.

- Standalone entry: `artifacts/api-server/src/game-server.ts` → bundled to
  `dist/game-server.mjs` (bare `http.Server` + 3 WS relays + `/healthz`; no
  db/clerk/express, self-contained, only needs `PORT`).
- Live URL: `https://game-server-production-b263.up.railway.app` (Railway project
  `animator-game-server`, service `game-server`).
- Redeploy: `RAILWAY_TOKEN=<project-token> artifacts/api-server/deploy-railway.sh`.
- The Animator client targets it via `VITE_GAME_SERVER_URL` (e.g.
  `wss://game-server-production-b263.up.railway.app`); when unset it falls back to
  same-origin. Wiring lives in `artifacts/animator/src/net/DangerClient.ts`.

### Cloudflare hosting (Pages + R2)

A static mirror of the Animator also deploys to Cloudflare (account "Grudge",
via the Replit Cloudflare integration):

- **Pages**: project `animator` → https://animator-49n.pages.dev (production
  branch `main`, direct-upload via wrangler, ~16MB lite bundle without media).
- **R2**: bucket `animator-assets` with the managed public domain
  `https://pub-a90887df105f43569b8764e544be124e.r2.dev` (CORS: GET/HEAD from `*`)
  holds all `public/` media (models/anim/audio/rooms/frames/avatar/backdrops/icons).
- Asset host switch: `VITE_ASSET_BASE_URL` (see `src/three/assetHost.ts`) — set at
  build time to the R2 public URL for Cloudflare builds; unset (same-origin) for
  Replit dev/deploy. `public/_redirects` (SPA fallback) + `public/_headers`
  (caching) ship in every build.
- Cloudflare build:
  `PORT=5000 BASE_PATH=/ NODE_ENV=production VITE_ASSET_BASE_URL=<r2-url> VITE_GAME_SERVER_URL=<railway-wss> pnpm --filter @workspace/animator-app run build`,
  then strip the media folders from a copy of `dist/public` and
  `wrangler pages deploy <dir> --project-name animator --branch main`.
- Gallery/login (Express API + Postgres + Clerk) are NOT on Cloudflare — those
  features need the Replit deployment (D1 would require a backend rewrite).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Animator: React + Vite, plain Three.js (NOT react-three-fiber — bespoke engine for full control), `@dimforge/rapier3d` physics, radix-ui + framer-motion UI
- API (retained): Express 5, PostgreSQL + Drizzle ORM, Zod, Orval codegen, esbuild bundle

## Artifacts (current)

- **Animator** (`artifacts/animator`, preview `/`, title "Animator") — the flagship app. See below.
- **API Server** (`artifacts/api-server`, preview `/api`) — retained Express backend (DB + OpenAPI-driven routes; also holds `@workspace/space-net` / `@workspace/carrier-net` netcode kept as shared libs).
- **Canvas / mockup-sandbox** (`artifacts/mockup-sandbox`, preview `/__mockup`) — powers the workspace canvas board (tooling, not a product).

> History: this project previously contained a voxel Game Studio, a Voxel Arcade
> game hub, and a Carrier multiplayer game. Those artifacts were deleted to focus
> entirely on the Animator. Some `.agents/memory/*` topic files still reference
> them — treat those as historical unless the code still exists.

## Animator (the flagship)

Internally the "Danger Room": a third-person character/combat/camera studio where
you live-tune movement, camera, combat, physics, and VFX feel for various rigs and
weapon classes. Built with plain Three.js for control; physics via Rapier.

- Entry: `src/main.tsx` → `src/App.tsx` manages top-level mode
  (`landing` / `doors` / `danger` / `voxel` / `play` / …) and UI overlays.
  The app boots into a Grudge ID landing page (puter.js sign-in wrapper in
  `src/auth/grudgeAuth.ts`, "Sign in with Grudge ID" + guest); `doors` is the
  home surface behind it — every mode exit returns to `doors`, and the doors
  grid only ever lays out 3×2 / 2×3 / 1×6. Base path comes from
  `import.meta.env.BASE_URL` (Vite `base` ← `BASE_PATH` env, now `/`); never hardcode `/animator/`.
- Engine core: `src/three/`
  - `Studio.ts` — scene owner: loop, renderer, physics, subsystem orchestration.
  - `Controller.ts` — bespoke third-person camera + movement (gravity, jump, dash/lunge, camera-relative WASD).
  - `Character.ts` (skinned GLB rigs) + `ExplorerCharacter.ts` (procedural rig).
  - `explorer/` — vendored high-level `Animator` state machine for weapon-based locomotion/combat clips.
  - `voxel/` — built-in Voxel Editor + Arena (`VoxelEditor.ts` serialize/load; `mapStore.ts` localStorage persistence with legacy single-slot migration). "Test" serializes the working map into a play session (no separate save step).
- Animation assets: `public/anim/` — FBX library categorized by weapon/action (bow, sword, magic, etc.).
- UI: `DoorSelect.tsx` → Danger Room (`Hud`, `AdminPanel`, `EditorPanel`, `AnimationsPanel`, `StatusDock`), Voxel Editor (`VoxelEditorUI`, `VoxelMapsPanel`), Dressing Room (3rd door), Play mode.
  - Dressing Room (App mode id `"editor"`, `EditorMode.tsx`): a focused character studio — Wardrobe (swap rig/skins + attach gear), Animations, VFX, Playground panels, plus transform gizmos/import/export. It was repurposed from a generic 3D "Scene Editor": the generic authoring tooling (add-primitives, structural build brushes, hierarchy/layers/inspector panels, colliders) was removed from both the UI and the AI assistant (`src/ai/editorTools.ts`). The internal mode id stays `"editor"`; only user-facing text is "Dressing Room". Auto-loads a default rig on entry when no gallery scene is reopened.
- Avatar Edit (App mode id `"avatar"`, 6th door): cube modular head builder — 6 races (human/barbarian/orc/undead/dwarf/elf) with modular hair/eyes/brows/facial-hair/ears/tusks/extras. Pure core in `src/three/avatar/` (`catalog.ts` data, `composeHead.ts` config→6 pixel faces + protrusion boxes, unit-tested), `HeadStage.ts` renders it (6 nearest-filtered CanvasTextures on a box + pooled protrusion meshes); per-race builds persist to localStorage.
- Dependencies: `three`, `@dimforge/rapier3d`(-compat), `@workspace/epicfight` (shared combat payloads), `@workspace/danger-net` (multiplayer netcode), `@workspace/api-client-react` (gallery/API hooks), `framer-motion`, `lucide-react`, radix-ui. (The artifact freely imports these `@workspace/*` libs — including in `src/three/` — only the Explorer rig + its FBX stay vendored/self-hosted.)
- A.L.E. (the duel director) also produces a per-contest broadcast package: a live
  fight recording log (P1 / P2 / A.L.E.), a "Match Recap by A.L.E.", and a ~10s
  narrated highlight review (browser `speechSynthesis` voice + captions + camera
  cuts; no external TTS). End goal is ad-ready promo videos, but their use is gated
  on the AI behaviours showing real skill-based meta-play (parry/block/dodge/timing) —
  the recap surfaces a "skill timing: ad-ready / not there yet" gate. Video export +
  publishing stay deferred until that bar is met.

### Memory pointers (still relevant)

The richest detail lives in `.agents/memory/animator-*.md` (lib design, locomotion
blend, weapon classes, target-lock, danger-room physics/VFX, dungeon mode, sparring
AI, procedural clip registration). Read those before changing the relevant subsystem.

## Workspace conventions

- Monorepo managed by pnpm; libs in `lib/*` are composite (built via `tsc --build`),
  artifacts are leaf packages typechecked with `tsc --noEmit`. Root `tsconfig.json`
  references libs only.
- Verify artifacts with `pnpm --filter @workspace/<slug> run typecheck`, not `build`
  (build needs workflow-provided `PORT`/`BASE_PATH`).
- The shared reverse proxy routes by path (`/` → Animator, `/api` → API Server);
  paths are not rewritten — services own their full base path.

## User preferences

_Add durable user preferences here as they come up._
