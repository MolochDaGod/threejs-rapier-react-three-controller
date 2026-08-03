# Voxel race defaults (Avatar Edit)

Production default playable characters for **voxel games** — not grudge6, not free-rpg TPose.

| Field | Use |
|-------|-----|
| `defaults.json` | Fleet SSOT: 6 races with `config` (head) + `look` (body) |
| `*-portrait.png` | Optional UI cards (export from Avatar Edit **Publish 6 races**) |

## Spawn

```js
const race = manifest.races.find(r => r.id === 'orc');
// Explorer / VoxelCharacter:
// look: { ...race.look, avatarConfig: race.config }
// height: race.heightM
```

## CDN

Upload this folder to R2 as `avatar/races/` (or `voxgrudge/avatar/races/`).
