# Production combat UX SSOT — threejs-rapier bar

**Canonical live bar:** https://threejs-rapier-react-three-controll.vercel.app/

## Systems (must ship on all combat play)

| System | Location | Notes |
|--------|----------|--------|
| Soft lock | `Studio.softLockEnabled` · Tab / RMB / Alt+Tab | Always-on aim assist; RMB hard lock stance |
| Hard lock | `Studio.locked` + `controller.setLockTarget` | Face + strafe enemy |
| Unit frames | `components/hud/UnitFrame.tsx` + `unitFrame.css` | Player + locked target gold plates |
| Stage frames | `FrameSkinModal` + `public/frames/frame-00..15.png` | 16 bezels + none |
| Crosshair | `Crosshair.tsx` | combat / harvest / ui modes + recoil bloom |
| Cursor | `CursorManager.tsx` | pointer-lock vs UI cursor |
| Weapon skills | `abilities/*` · `arsenal/*` · skill slots 1–4 | Cooldowns + cast charge |
| Spell shaders | `Vfx.ts` fireUniforms / ShaderMaterial trails | Needs **post bloom** to read |
| Post FX | `three/fx/postfx.ts` | pmndrs stack · combat / spell / cinematic presets |
| Camera | Controller chase + `DuelCamera` ALE modes | Soft-lock pull + FOV kick |

## Post-processing (mandatory for production)

Spell/fire/soul ShaderMaterials are HDR-ish additive. Without bloom they look flat.

```ts
// Studio constructor after camera:
this.initPostFx(); // createMysticalComposer combat preset

// render loop:
this.renderFrame(dt); // composer.render or fallback

// ability cast:
this.pulseSpellPostFx(0.5); // temporary spell bloom kick
```

Presets: `combat` (readable) · `spell` (cast kick) · `cinematic` (lobby).

## Fleet sync

| App | Status |
|-----|--------|
| threejs-rapier Animator | **Wired** postfx + spell pulse (this pass) |
| gameopen Open / Danger | Already had postfx; **synced** enhanced postfx + pulse |
| GRUDOX arcade embeds | Own cabin stacks; enable when native |

## Deploy

```bash
cd threejs-rapier-react-three-controller
pnpm --filter @workspace/animator-app run build
vercel --prod   # project threejs-rapier-react-three-controll

cd gameopen
npm run deploy:prod   # open.grudge-studio.com
```

## Character picker (production)

- No Sensei / karate-boss
- No 24 grudge6 race×class catalog entries in Admin/Playground
- No ikkau / demo seat names (campfire filter)
- Account select: Ethereal Falls campfire · `?door=characters`

Full cast + hotkeys + hip SSOT: **`docs/PRODUCTION_CONTROLLER.md`**.

## MM systems

Interpret as multiplayer + map markers:

- Danger net / remotes in Studio
- World minimap / blips on Velocity cruise
- Fleet character handoff `characterId` into combat skins
