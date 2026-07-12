---
name: Animator Danger Room presets
description: How selectable Danger Room environments are structured and what must stay preset-independent
---

# Danger Room environment presets

`src/three/RoomPresets.ts` holds data-driven presets (`holo`/`foundry`/`colosseum`):
colors, gridOpacity, accent lights, and a `PropSpec[]` placed at corners (C=13) so
nothing intrudes on the combat zone, training dummies, or punching-bag arc.
Persisted per-session in `sessionStorage` key `dangerroom:preset` (default `holo`).

`DangerRoom.setPreset(id)` disposes + rebuilds from the preset. **These stay
preset-independent and must keep working after any rebuild:** the door portal,
DJ alcove + `djBoothAnchor`, and all combat coordinates. The DJ booth lives in the
scene (not `room.group`), so `clearBuilt()`/rebuild never touches it.

**Why:** grid visibility is two-part — `gridWanted` (caller intent) AND
`preset.gridOpacity > 0`. `Studio.setParams()` calls `setGridVisible(true)` often;
that safely no-ops for non-grid presets. `Studio.setRoomPreset()` re-asserts it
after a swap.

**How to apply:** App owns React state + sessionStorage; `Studio` constructor reads
`loadRoomPreset()` so a fresh remount matches. `VoxelEditor` uses `new DangerRoom({ open: true })`
(holo, floor+grid only) — keep that path working when changing the constructor.

## Per-preset atmosphere + ambient bed

Each preset carries optional `atmosphere` (fog color/near/far + optional bg) and
`ambience` (lowpass cutoff/gain/drift) data. `Studio.applyRoomAtmosphere(applyNow)`
folds the preset's atmosphere into the `baseFog*`/`baseBgColor` **baseline fields**
(NOT the static `FOG_BASE_*` constants) that the underwater `updateWaterFx` lerps
FROM; missing atmosphere falls back to `FOG_BASE_*`. `applyRoomAmbience()` pushes
`ambience` to `CombatSfx.setAmbientProfile()` (retunes live lowpass/pan-LFO + bed
level via the existing mute/master mixer — never bypasses it).

**Why:** dungeon entry/exit shares the same fog. The dungeon must stay dark
regardless of room preset, so `enterDungeon` resets the baseline to `FOG_BASE_*`
and `exitDungeon` calls `applyRoomAtmosphere(true)` to restore the room's mood.
`updateWaterFx` runs every frame in the Danger Room too (inWater=false, k=0), so it
re-asserts the baseline — keep the baseline = the desired dry look.

**How to apply:** when adding atmosphere/ambience to a preset it's pure data. Audio
+ fog are WebGL/gesture-gated → offline-unverifiable; the `lp` BiquadFilterNode must
be stored on the `Ambient` object or `setAmbientProfile` can't retune it live.
