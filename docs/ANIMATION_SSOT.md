# Animation SSOT — Explorer + grudge6 (this bar)

**Live:** https://threejs-rapier-react-three-controll.vercel.app/  
**Repo:** `threejs-rapier-react-three-controller` · package `@workspace/animator-app`

Do **not** invent a second mixer, second retarget path, or mix Mixamo tracks onto Bip001.

---

## Two skeletons, two packs (never cross-bind)

| Avatar | Skeleton | Clip host | Catalog SSOT |
|--------|----------|-----------|--------------|
| **Explorer** | Mixamo (`mixamorig*`) | `public/anim/animations/**` FBX/GLB | `src/three/explorer/clipCatalog.ts` + `clipRegistry.ts` |
| **grudge6** | Bip001 | CDN `/anims/baked/**.json` (rotation-only) | `src/three/grudge/anims.ts` → `ANIM_PACK_CLIPS` |

| Rule | Detail |
|------|--------|
| Explorer | Load Mixamo FBX via explorer loader; root-lock; directional loco via `Animator.setStrafe` + 8-dir walk/run |
| grudge6 | `loadBakedClip` only; strip/position lock via `stabilizeClipForPlayback`; **no** mixamorig rematch |
| Facing | grudge6 art-forward +Z already in kit normalize; Explorer uses root yaw + modelYaw |
| Feet | Box3 min.y / FootGrounder — never pelvis-as-feet |

---

## Explorer folder layout (`public/anim/animations/`)

```
animations/
  bow/          # UNIVERSAL 8-dir walk/run + dodge F/B/L/R + jump (fallback for all classes)
  sword/        # 1H + shield idle/run/strafe/attacks
  greatsword/   # 2H stance + combo
  magic/ + magic-loco/
  pistol/ rifle/ shotgun/
  knife/ spear/ greataxe/ mace/ striker/
  block/        # parry, left/right block, block idle/react
  reactions/    # stumble, fall, kip-up, stunned, wall-crash
  extra/        # acrobatics (air dodge, flips, slide, utility kick)
  climb/ swim/ farming/ gestures/
```

**Mapping:** `clipCatalog.ts` `WEAPON_SETS` + `UNIVERSAL_LOCO` / `UNIVERSAL_MOVEMENT`.  
**Verbs:** `clipRegistry.ts` (preview library + combat-only dodge verbs).

Controller → `setLocomotionDirectional` → Explorer stores body-frame x/z → `Animator.setStrafe` + 8-dir blend.

---

## grudge6 baked packs (CDN)

Base: `https://assets.grudge-studio.com/anims/baked/` (or `VITE_ASSET_BASE`).

| Pack id | Core | Directional | Defense |
|---------|------|-------------|---------|
| `sword_shield` | idle, walk, run, attack | borrow longbow 8-dir | `sword-and-shield-block` (+ parry alias) |
| `longbow` | idle, walk-forward, run-forward, draw | full walk/run F/B/L/R | — |
| `magic` | standing idle/walk/run F + attack | standing walk/run B/L/R | — |
| `unarmed` | fight_idle, walk, run, punch | longbow 8-dir fill | — |
| sprint (all) | `uploads_2026_06/locomotion/running` | — | — |

Code: `packClipRels(pack)` lists every rel a kit will try to load.

**Missing on CDN (do not invent local fakes):** dedicated dodge rolls, many reactions, cast-specific magic. Studio still dashes on X; clip falls back to walkB / hurt when present.

---

## Blending contracts

| System | Owner |
|--------|-------|
| Explorer idle↔walk↔run weights | `explorer/LocomotionBlend.ts` |
| Explorer 8-dir pick | `Animator` strafe + `move.x/z` |
| GLB Character dir override | `Character.setLocomotionDirectional` + `directionalBlendWeights` |
| grudge6 gait | `GrudgeAvatar.setLocomotion` / `setLocomotionDirectional` |
| Pure weight math | `anim/blend.ts` |
| One-shots | Explorer `playOnce` / grudge `playClipOnce` — yield loco while active |
| Block hold | Explorer `Animator.block` · grudge `setBlock` looped `block` clip |

---

## Defense / combat clip verbs (shared names)

Studio holdStyle + Avatar must resolve these names (real clip or alias):

| Verb | Explorer | grudge6 |
|------|----------|---------|
| block / blockStart | block pack FBX | `block` → sword-and-shield-block |
| parry / parryReact | block/parry.fbx | alias to block until CDN ships parry |
| dodgeF/B/L/R | bow standing-dodge-* | optional; dash always from Controller |
| hurt / stumble | reactions/* | optional |

---

## Projectile aim (related)

`src/three/aim/resolveFireAim.ts` — lock → lead → screen-centre ray.  
Staff bolt + fire combo use it; other skills should migrate to the same helper.

---

## Adding a new animation (checklist)

### Explorer (Mixamo)

1. Drop FBX under `public/anim/animations/<folder>/`  
2. Add id to `clipCatalog.ts` (`WEAPON_SETS` or `UNIVERSAL_*`)  
3. Register verb in `clipRegistry.ts` if HUD/preview needs it  
4. Smoke: Dressing Room verb list + Danger Room input  

### grudge6 (Bip001)

1. Bake rotation-only JSON → upload `anims/baked/<pack>/<name>.json`  
2. Add rel to `ANIM_PACK_CLIPS` (+ aliases if needed)  
3. Confirm `loadBakedClip` 200 on assets host  
4. Smoke: grudge hero idle / walk / attack / block / lock-strafe  

---

## Catalog + checklist (CSV)

| File | Role |
|------|------|
| `docs/ANIMATION_CATALOG.csv` | Full inventory: name, length, hip/xz, type, weapon, domain, verified |
| `docs/ANIMATION_CHECKLIST.md` | Counts + how to promote `pipeline_locked` → `measured_pass` |
| `artifacts/animator/scripts/build-anim-catalog.mjs` | Regenerator |

```bash
cd artifacts/animator
pnpm run anim:catalog          # local scan
pnpm run anim:catalog:cdn      # + fetch grudge6 CDN durations
```

## Related

- `docs/PRODUCTION_CONTROLLER.md` — hotkeys  
- Skills: `grudge6-full-stack`, `grudge-character-correctness`, `grudge6-combat-runtime`  
- Explorer root lock: `rig/rootLock.ts`  
