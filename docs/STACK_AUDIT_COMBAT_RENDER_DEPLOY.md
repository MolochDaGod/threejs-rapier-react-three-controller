# Stack audit — conflicts, rendering, deploy, deps (combat / anim / math)

**Repo:** `threejs-rapier-react-three-controller` · app `@workspace/animator-app`  
**Live:** https://threejs-rapier-react-three-controll.vercel.app/  
**Date:** 2026-08-03  

Honest inventory for Conan-feel / combat improvement. **Do not invent parallel systems** — extend listed SSOT only.

---

## 1. Conflicts & issues (priority)

| Severity | Issue | Evidence | Action |
|----------|--------|----------|--------|
| **High** | **three version skew** | `package.json` asks `three@^0.185.1` but lock installs **`three@0.184.0`**; `@types/three@0.184.1` | Pin both to **0.185.x** (or both 0.184) with `pnpm why three` + lockfile update; redeploy |
| **High** | **`file:` @grudge-studio/\*** | `dependencies` point at `../../../../GrudgeStudioNPM/packages/*` | Works on your machine (`F:\GitHub\GrudgeStudioNPM`); **Vercel CI fails** if that path is missing on the build image | Prefer published npm or monorepo workspace packages on Vercel; never rely on absolute local file: for prod |
| **Medium** | **Rapier dual packages** | Both `@dimforge/rapier3d` and `@dimforge/rapier3d-compat` in package.json | Runtime uses **`rapier3d-compat` only** (`PhysicsSystem.ts`). Drop unused `rapier3d` to shrink install risk |
| **Medium** | **Vite wasm plugins declared, not wired** | `vite-plugin-wasm` + `top-level-await` in package.json; **`vite.config.ts` does not use them** | If Rapier wasm fails on some deploys, add plugins to `vite.config.ts` (compat package often works without; verify before adding noise) |
| **Medium** | **TS: `applySpineAim` not on `Avatar`** | `Studio.ts` calls `this.character.applySpineAim?.(...)` but interface lacks optional method | Add `applySpineAim?` to `Avatar` in `types.ts` (typing only; Character/Grudge already implement) |
| **Medium** | **Gameplay deps in `devDependencies`** | `three`, rapier, postprocessing, epicfight workspace | Vite bundles them, but **prod install/Vercel** can drop devDeps depending on settings | Move runtime deps to `dependencies` for honesty |
| **Low** | **Tone mapping path** | Studio sets ACES on renderer, then `createMysticalComposer` sets **NoToneMapping** + composer ACES | Correct if postfx always inits; fallback path restores prev — OK. Avoid re-setting ACES after composer create |
| **Low** | **Extra AnimationMixers** | Wildlife, VFX, ParrotPet each own a mixer | **OK** if not on the same skinned player body. **Ban:** second mixer on player root |
| **Low** | **Anim orphans / load fails** | See `ANIMATION_WIRING_AUDIT.md` | Wire or quarantine; empty/broken FBX stay dead |
| **Info** | **Harvest lab local-only** | Phase C not deployed until intentional push | Documented in `CONAN_FEEL_ROADMAP.md` |

### Not conflicts (correct as-is)

| Topic | Status |
|-------|--------|
| One play camera writer | Controller owns TPS; Orbit only editors |
| Soft lock vs hard lock | Soft = assist; hard = RMB seize |
| epicfight combat SM | Single CC for player defense economy |
| Mixamo vs Bip001 | Separate catalogs; no cross-retarget at runtime |

---

## 2. Rendering risks

| Risk | Detail | Best practice |
|------|--------|----------------|
| **Double tone map** | Renderer ACES + postfx ACES | Keep composer → `NoToneMapping` on renderer (already) |
| **Bloom wash** | Spell pulse high intensity | Combat preset low; pulse only on cast |
| **HalfFloat composer** | Cost on mobile | Cap DPR at 2 (already); optional mobile low preset |
| **Shadow cost** | PCF shadows on | Gate shadow map on quality setting if FPS tanks |
| **Texture color space** | Maps use `SRGBColorSpace` in several loaders | Keep consistent; never leave default Linear on albedo |
| **Spine IK after mixer** | Studio order: mixer → foot → spine aim | Do not reorder (double transform fight) |
| **Multiple WebGL renderers** | Studio + HeadStage + portraits | Dispose offscreen renderers; avoid leaking contexts |

---

## 3. Deployment risks

| Risk | Detail |
|------|--------|
| **Root / output** | Vercel: `artifacts/animator`, `dist/public`, install from monorepo root via pnpm |
| **file: monorepo packages** | Break remote build if GrudgeStudioNPM not in CI |
| **API rewrites** | `vercel.json` proxies Railway / id / objectstore / danger — CORS ok only via same-origin `/api` |
| **Asset base** | grudge6 baked clips need `VITE_ASSET_BASE` / default CDN; empty local = 404s |
| **Frozen lockfile** | install uses `--no-frozen-lockfile` (flexible but non-reproducible) |
| **Dirty tree deploy** | Local control/harvest/anim work not live until intentional deploy |

**Smoke after any prod deploy:**

```text
GET /  → 200 SPA
GET /api/health → Railway (not HTML 404)
Danger: walk, sprint stamina, soft lock, melee harvest node (after deploy of Phase C)
```

---

## 4. Dependencies — what you need vs what to skip

### Keep / already present (fleet-aligned)

| Need | Package / in-repo | Role |
|------|-------------------|------|
| Renderer | `three` **pin 0.185.x** | Scene, mixer, math |
| Physics | `@dimforge/rapier3d-compat` | World + bags + KCC |
| Post FX | `postprocessing` | Bloom / ACES combat grade |
| Combat SM | `@workspace/epicfight` | Stamina, dodge, parry, block |
| Types | `@types/three` **match three major** | |

### Math (combat / aim / blend)

| Option | Recommendation |
|--------|----------------|
| **`three` Vector3/Quaternion/MathUtils** | **SSOT — keep** |
| **In-repo** `anim/blend.ts`, `predictiveLead.ts`, `aim/resolveFireAim.ts`, `aim/AimSystem.ts` | **SSOT — extend** |
| **`maath`** | **Skip** unless you adopt R3F-wide fleets; duplicates three math |
| **`gl-matrix`** | **Skip** — second math lib |

### Animation graphing

| Option | Recommendation |
|--------|----------------|
| **In-repo** `LocomotionBlend` + `Animator` + one-shots | **SSOT** |
| **Unity Animator / Unreal AnimBP as npm** | **Does not exist** — use as design reference only |
| **Motion matching library** | Research later; not required for Conan Phase A–D |
| **Second AnimationMixer on player** | **Banned** (fleet hard rule) |
| **Spine (Esoteric) runtime** | **Only if** you ship Spine2D JSON/skel assets — you do **not** today |

### “Spine” in this codebase

| Meaning | Status |
|---------|--------|
| **Skeletal spine bones + aim IK** | In-repo `anim/spineIk.ts` — **keep / type on Avatar** |
| **Esoteric Spine 2D** (`@esotericsoftware/spine-threejs`) | **Do not add** unless art pipeline switches to Spine exports |

### UUID

| Option | Recommendation |
|--------|----------------|
| **`crypto.randomUUID()`** | Already used (`mapStore`, drafts) — **prefer** |
| **`uuid` npm** | **Optional** only for older Safari edge cases; not required for modern Chromium/Firefox |
| **Server/Railway character ids** | Prefer backend UUIDs; client ids = local draft only |

### Combat improvement (no new deps required)

| Need | Source |
|------|--------|
| Hit windows / stamina / parry | `@workspace/epicfight` |
| Soft/hard lock | `Controller` + `Targets.acquireSoftLock` |
| Weapon kits / cast times | `arsenal/*` |
| Fleet patterns | skills `grudge-fleet-combat`, `grudge-combat-targeting` |
| Optional later | `three-mesh-bvh` (mesh ground), `three-pathfinding` / `yuka` (AI nav) — **only when outdoor maps need them** |

---

## 5. Best practices — combat feel (Conan / survival)

1. **One combat authority** — player defense economy in CombatController only.  
2. **One mixer per body** — loco blend + one-shots on that mixer.  
3. **Root motion locked** — controller owns XYZ; clips rotate joints.  
4. **Soft lock ≠ hard lock** — soft = assist; hard = sticky face/strafe.  
5. **Hit frames** — damage on active windows, not button-down only.  
6. **Stamina shared** — sprint + dodge + block + skills (Phase A).  
7. **Same session on map change** — Controller + weaponId + viewMode.  
8. **SI** — 1 unit = 1 m; human ~1.8 m.  
9. **Wire anims only via clipCatalog** — orphans do not improve combat.  
10. **Deploy intentional** — one product intent per prod push.

---

## 6. Recommended next fixes (ordered, small)

| # | Fix | Status |
|---|-----|--------|
| 1 | Align `three` + `@types/three` to 0.185.x | **Done** (`three@0.185.1` + `@types/three@0.185.1`; 0.185.2 not on npm) |
| 2 | Runtime deps in `dependencies` | **Done** (three, rapier-compat, postprocessing, epicfight, react, etc.) |
| 3 | Remove unused `@dimforge/rapier3d` | **Done** (compat only) |
| 4 | `applySpineAim?` on `Avatar` | **Done** |
| 5 | Document Vercel `file:` risk | **Done** (`PRODUCTION.md`) |
| 6 | Wire vite wasm + top-level-await | **Done** (`vite.config.ts`) |
| 7 | Combat: hit-frame polish (combo on clip impact) | **Done locally** (opener/mid/finisher fracs) |
| 8 | Phase D camp + kenney GLB + blueprint browser | **Done locally** (KeyB, SurvivalHud) |
| 9 | Tool wheel / Open harvestTools | **Done locally** (KeyU, `game/inventory/harvestTools.ts`) |
| 10 | Phase B camp Rapier cuboids + Phase E HUD surface | **Done lab** (not full outdoor island) |
| 11 | Intentional Vercel deploy of A–E lab | Pending |

**Do not** add: maath, gl-matrix, uuid (yet), spine-threejs, a second physics engine, a second anim graph package.

---

## 7. Related docs

- `docs/PRODUCTION.md` — env + deploy  
- `docs/CONAN_FEEL_ROADMAP.md` — Phase A/C status  
- `docs/ANIMATION_WIRING_AUDIT.md` — clip orphans  
- `docs/ANIMATION_SSOT.md` — Mixamo vs Bip001  
- Fleet: `grudge-3d-game-packages`, `grudge-fleet-combat`  

---

## Summary

| Area | Verdict |
|------|---------|
| **Biggest deploy risk** | `file:` @grudge-studio + three lock skew |
| **Biggest render risk** | OK if postfx owns tone map; watch mobile bloom cost |
| **Math deps** | Keep three + in-repo pure math modules |
| **Anim graph** | Keep in-repo blend/director; no new graph npm |
| **Spine** | Bone IK in-repo; not Spine2D runtime |
| **UUID** | `crypto.randomUUID` enough |
| **Combat** | Improve via epicfight + lock + wired clips — not new packages |
