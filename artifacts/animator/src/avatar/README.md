# Avatar System

A self-contained cube-head character builder for browser 3D apps.  
Drop the entire `avatar/` folder into any project to get:

- **6 playable races** — Human, Barbarian, Orc, Undead, Dwarf, Elf  
- **Modular part slots** — skin, hair, eyes, brows, facial-hair, ears, tusks, extras, hats, headgear  
- **Live 3D preview** — Three.js scene with drag-to-orbit, per-pixel-face canvas textures, hair strands & motion  
- **React editor UI** — full drag-and-drop editor with colour swatches, style chips, part nudge/scale sliders  
- **2D portrait export** — pure-canvas front-projection (no WebGL, works headless)  
- **Share codes** — `encodeConfig` / `decodeConfig` pack a full build into a short URL-safe string  
- **Persistence** — localStorage save/load per race, plus a "Save to Character" slot for the in-game rig  

---

## File map

| File | Depends on | What it does |
|---|---|---|
| `catalog.ts` | nothing | All types, race data, style lists, colour swatches, encode/decode |
| `pixels.ts` | nothing | 16×16 pixel-grid primitives (`makeGrid`, `px`, `hline`, `rect`, `cssHex`, …) |
| `composeHead.ts` | catalog, pixels | Pure composer: `AvatarConfig` → 6 face grids + protrusion boxes |
| `portrait.ts` | pixels, catalog, composeHead | `renderPortraitDataUrl(cfg, px)` — 2D front-view PNG data-URL |
| `hairTexture.ts` | pixels | Procedural per-hair-box pixel textures (used by hairStrands) |
| `hairMotion.ts` | three, pixels, composeHead | Pendulum physics rig for hanging hair / beards |
| `hairStrands.ts` | three, pixels, composeHead, hairTexture | GPU instanced strand overlay (InstancedMesh, one draw call) |
| `hats.ts` | three, GLTFLoader, catalog | Async GLB hat loader + clone-based mounting |
| `HeadStage.ts` | three, pixels, catalog, composeHead, hairStrands, hairMotion, hats | Full Three.js stage — owns renderer, loop, orbit controls |
| `playerHead.ts` | three, pixels, catalog, composeHead, hairStrands, hairMotion, hats | In-game bridge: applies saved head onto an Explorer rig's box cube |
| `AvatarEditMode.tsx` | react, lucide-react, HeadStage, catalog, composeHead, playerHead, pixels | Full React editor (6th door) |
| `avatarEdit.css` | — | Editor styles |

Tests mirror each pure module (`composeHead.test.ts`, `hairMotion.test.ts`, `hairStrands.test.ts`, `hairTexture.test.ts`, `portrait.test.ts`).

---

## Dependencies

| Package | Used by |
|---|---|
| `three` | HeadStage, hairMotion, hairStrands, hats, playerHead |
| `three/examples/jsm/loaders/GLTFLoader.js` | hats |
| `react` | AvatarEditMode |
| `lucide-react` | AvatarEditMode (icons) |

All of the pure logic files (`catalog`, `pixels`, `composeHead`, `portrait`, `hairTexture`) have **zero runtime dependencies** — they're fully unit-testable without a DOM or Three.js.

---

## Quick start

### 1 · Show the editor (React)

```tsx
import { AvatarEditMode } from "./avatar/AvatarEditMode";

function App() {
  return <AvatarEditMode onExit={() => console.log("done")} />;
}
```

The editor writes the chosen build to `localStorage` under `"avatarEdit:playerHead:v1"` when the user clicks **Save to Character**.

---

### 2 · Render a 2D portrait (no WebGL)

```ts
import { defaultConfig, renderPortraitDataUrl } from "./avatar";

const cfg = defaultConfig("orc");
const dataUrl = renderPortraitDataUrl(cfg, 192); // 192 × 192 px PNG
document.querySelector("img").src = dataUrl;
```

---

### 3 · Embed the 3D head preview

```ts
import { HeadStage } from "./avatar/HeadStage";
import { defaultConfig } from "./avatar/catalog";

const canvas = document.getElementById("my-canvas") as HTMLCanvasElement;
const stage = new HeadStage(canvas);
stage.setConfig(defaultConfig("elf"));

// On teardown:
stage.dispose();
```

`HeadStage` owns its own `WebGLRenderer` and animation loop — just give it a `<canvas>`.

---

### 4 · Generate a share code

```ts
import { encodeConfig, decodeConfig, randomConfig } from "./avatar";

const cfg = randomConfig("barbarian");
const code = encodeConfig(cfg);   // e.g. "bHMxRmFzaA..."
const back = decodeConfig(code);  // round-trips exactly
```

---

### 5 · Compose faces without WebGL (pure logic)

```ts
import { composeHead } from "./avatar/composeHead";
import { defaultConfig } from "./avatar/catalog";

const { faces, protrusions } = composeHead(defaultConfig("dwarf"));
// faces: { front, back, left, right, top, bottom } — each a 16×16 number[]
// protrusions: ProtrusionBox[] — positioned boxes for ears, hair, tusks, etc.
```

---

## Asset files (hats)

`hats.ts` loads two GLB files from `public/avatar/hats/`:

| File | Contents |
|---|---|
| `hat-pack.glb` | 7 named hats sharing one texture atlas (Pirate / Cowboy / Witch / TopHat / Princess / Astronaut / Hood) |
| `pirate-voxel.glb` | Voxel-art pirate hat |

Copy the `public/avatar/` folder alongside the code.  
`hats.ts` resolves URLs via an `assetUrl(path)` helper (imported from `../three/assetHost` in this project).  
**When porting:** replace that import with your own URL resolver, e.g. `const assetUrl = (p: string) => p;`.

---

## localStorage keys

| Key | Contents |
|---|---|
| `avatarEdit:builds:v1` | JSON map of `{ [raceId]: AvatarConfig }` — one saved build per race |
| `avatarEdit:lastRace:v1` | Last selected race id |
| `avatarEdit:playerHead:v1` | The build the user "Saved to Character" (read by `loadPlayerHeadConfig`) |
| `avatarEdit:raceDefaults:v1` | Published package of all 6 production race defaults (fleet seed) |

## Production 6 race defaults (voxel games)

```ts
import { listRaceDefaults, raceDefault, buildRaceDefaultsManifest } from "./avatar/raceDefaults";

const orc = raceDefault("orc");
// orc.config  → AvatarConfig (modular cube head)
// orc.look    → Explorer CharacterLook (skin/shirt/pants + avatarHead)
// orc.code    → share code AV1.…
// orc.avatarId → "avatar-orc" for fleet handoffs

// Spawn Explorer with a race default:
// createAnimatedCharacter({ look: { ...orc.look, avatarConfig: orc.config }, height: orc.heightM })
```

Ship file: `public/avatar/races/defaults.json` (export via Avatar Edit **Publish 6 races** or `node scripts/export-voxel-race-defaults.mjs`).

---

## Porting checklist

- [ ] Copy the entire `avatar/` folder  
- [ ] Copy `public/avatar/hats/*.glb`  
- [ ] Install `three` + `lucide-react` (if using the React editor)  
- [ ] Replace `assetUrl` in `hats.ts` with your asset-URL resolver (or hardcode the path)  
- [ ] Import from `./avatar` (barrel) or individual files as needed  
