# Fleet character → Animator (main game) merge

**Canonical game:** https://threejs-rapier-react-three-controll.vercel.app/  
**Character creation / roster:** GRUDOX + Grudge ID (`grudox.grudge-studio.com`, fleet APIs)

## Goal

Players make Warlords-era characters on GRUDOX (race, class, gear). When they open the **Animator** game, that same hero is the playable body — modular grudge6 race FBX + gear preset, not a generic Explorer capsule.

## Data flow

```
GRUDOX / id.grudge-studio.com
        │  sign-in → grudge_auth_token
        │  POST/GET /api/characters (Warlords)
        ▼
localStorage: grudge_auth_token, grudge.activeCharId
        │
        ▼
Animator (this repo)
  auth/fleetCharacter.ts
    resolveFleetPlayerLoadout()
      → race + class → characterId `grudge-{race}-{class}`
      → default weapon / off-hand
        │
        ▼
  App.tsx → Studio.setCharacter(id)
        │
        ▼
  Studio.spawnCharacter
    grudge-* id → GrudgeAvatar(race, preset)
      FBX + texture from assets.grudge-studio.com
      gear preset meshes + baked anim packs
```

## ID mapping

| Fleet / API race | Animator race slug |
|------------------|--------------------|
| human, wk, kingdom | western-kingdoms |
| barbarian, brb | barbarians |
| dwarf, dwf | dwarves |
| elf, high-elves | high-elves |
| orc | orcs |
| undead | undead |

| Fleet class / hint | Preset | Default weapons |
|--------------------|--------|-----------------|
| knight, paladin | knight | sword + shield |
| warrior, melee | warrior | greataxe |
| ranger, archer, ranged | ranger | bow |
| mage, magic, wizard | mage | staffFire |
| civilian, unarmed | unarmed→warrior kit | none |

Catalog character id: `grudge-barbarians-knight` (etc.).

## Auth handoff from GRUDOX

Preferred deep links:

```
https://threejs-rapier-react-three-controll.vercel.app/?token=<JWT>&characterId=<char_…>
```

or SSO fields already used by `grudge-fleet.js` (`sso_token`, `grudge_id`).

Token is also read from `localStorage.grudge_auth_token` when the player already signed in on a shared parent domain / prior visit.

## Code touchpoints

| File | Role |
|------|------|
| `src/auth/fleetCharacter.ts` | Resolve active fleet character → loadout |
| `src/App.tsx` | Boot-time resolve + apply to Studio |
| `src/three/Studio.ts` | `spawnCharacter` uses `GrudgeAvatar` for `grudge-*` ids |
| `src/three/grudge/*` | Modular race kit (already vendored) |

## GRUDOX launcher

Point game tiles at the Animator URL with token + active character:

```html
<a href="https://threejs-rapier-react-three-controll.vercel.app/?token=${token}&characterId=${activeCharId}">
  Play Animator
</a>
```

Or embed `grudge-fleet.js` on the Animator host and call `GrudgeFleet.syncFromBackend()` before play (optional; pure fetch path works without it).

## Verification

1. Sign in on GRUDOX, create/select a Warlords character (e.g. orc warrior).
2. Open Animator with session token (or same browser after SSO).
3. Console: `[Animator] fleet hero → grudge-orcs-warrior …`
4. Scene shows modular race mesh (not Explorer box), matching race texture/gear.
5. Combat uses class default weapon; Q loadout still works.

## Follow-ups

- Persist equipment JSON from fleet character into mesh visibility overrides.
- TVS voxel units as alternate skins when `modelPath` points at `models/voxels/tvs/...`.
- Multiplayer `PlayerState.characterId` = same grudge catalog id for remote avatars.
