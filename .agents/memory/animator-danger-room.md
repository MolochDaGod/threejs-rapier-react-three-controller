---
name: Animator Danger Room artifact
description: Gotchas for the self-contained three.js "animator" artifact and react-vite scaffold self-containment.
---

# Animator (Danger Room) artifact

A standalone react-vite three.js artifact (preview `/animator/`): rigged GLB
character in a sci-fi training room, third-person controller, animation
blending, double jump, admin/editor panels, procedural weapons + VFX. Built to
be fully self-contained — no `@workspace/*` imports — so it can be lifted out.

## Durable gotchas

- The **react-vite scaffold ships a `@workspace/api-client-react: "workspace:*"`
  dependency in package.json** even when nothing imports it. For a truly
  self-contained artifact you must remove it from package.json (and reinstall) —
  grepping src for `@workspace/` is NOT enough; the dep line is the violation.
  **Why:** a leftover workspace dep breaks the "deployable from its own folder"
  guarantee. **How to apply:** after scaffolding any artifact meant to be
  standalone, audit package.json deps, not just imports.
- `SkeletonHelper` is a **three core export** (`import { SkeletonHelper } from
  "three"`), NOT in `three/examples/jsm/Addons.js`. Importing it from Addons is
  a runtime error.
- `THREE.Timer` is **not shipped** in the three 0.184 build here (no
  `examples/jsm/misc/Timer.js`). Keep `THREE.Clock`; its deprecation warning is
  harmless.
- Headless screenshots can't create a WebGL context in this env (software
  renderer fails), so three.js artifacts here are **manual-verify only** — rely
  on typecheck + a 200 from the proxy. Wrap renderer construction in try/catch
  and show a fallback so a context failure doesn't crash with a raw React error.

## Clip retargeting onto skinless Sketchfab GLBs

- Mixamo FBX clips (26-bone `mixamorig:*` skeleton) cannot be retargeted onto a
  skinless low-bone Sketchfab GLB (e.g. the Striker's `sanji.glb`, ~14 bones
  named `Head_2`/`Body_8`/`RightArm_14`). The bone-name sets are **disjoint** and
  the rest poses/topology differ, so injecting FBX clips via `Character.addClip()`
  animates **nothing** (frozen joints) and SkeletonUtils-style rename retargeting
  can't bridge them. **Why:** no shared skeleton or naming convention exists to
  map tracks. **How to apply:** for these GLBs, drive moves off the model's OWN
  native embedded clips (the Striker GLB ships Diable Jambe, Have a Taste, Anti
  Matter Kick Course, Party Table Kick Course, etc.) and delete the dead FBX
  pipeline rather than adding a retarget helper.

## Async-load races (general pattern reused here)

- Character swaps load GLBs async; guard with a monotonic `loadToken` captured at
  call start and re-checked after `await` — discard + dispose stale loads so the
  latest selection always wins.
- Drive dependent UI (e.g. signature-skill labels) off a load-complete callback,
  not a fixed `setTimeout`, or it desyncs on slow loads.
- Gate global keydown with `if (e.repeat) return` for action keys, else a held
  key (Space) fires repeatedly and burns multi-step actions like double jump.
