---
name: Explorer RPG UI suite
description: How the Explorer cabinet's RPG game-UI overlay is wired into the engine and persisted, plus its non-obvious constraints.
---

# Explorer RPG UI suite (artifacts/arcade)

An additive ARPG game-UI suite skinned over the Explorer cabinet. The overlay
(`GameUiOverlay` + `ui/panels/*`) is driven by a reactive singleton store
(`game/store.ts`, `useSyncExternalStore`); the engine (`ExplorerGame.ts`) stays
the calm sandbox underneath.

## Non-obvious constraints

- **Panel-toggle hotkeys must avoid the engine's fixed keys** (WASD/Shift/Space/
  Digit1-4/Ctrl/F/R/Q/E/V/C). The overlay uses I/K/N/J/G/Tab/U/O and Esc only.
  Adding a new panel hotkey that collides will fire engine combat/movement too.
- **Engine ↔ store coupling goes one direction via setters, not store reads in
  the engine.** Skill move-speed reaches the engine through
  `ExplorerGame.setSpeedMultiplier(game.moveSpeedMult)`, pushed from a
  `game.subscribe` effect in the launcher (re-run on `phase` so a fresh engine
  gets the current value). The pure-data engine never imports the store.
- **Travel quest distance comes from HUD position deltas**, diffed each frame in
  `GameUiOverlay` (`game.recordEvent("travel", dist)`), clamping teleports
  (>50) and jitter (<0.01). HUD x/z are the only position signal the overlay has.

## Persistence

- `game/persistence.ts` stores the whole `game.serialize()` snapshot under one
  Puter KV key (`arcade:explorer:rpg`), best-effort: no-op when signed out / SDK
  missing, try/caught JSON. Guests can't persist until they upgrade their
  account (Puter temp accounts have no durable KV across sessions).
- Launcher loads once on mount, autosaves every 30s + on unmount + on
  change-world. `hydrate` guards `version` and uses `??` fallbacks so partial /
  old snapshots degrade instead of throwing.

**Why:** keeps the suite fully additive — it must never break the zombie/boat/
explorer cabinets, which share `Play.tsx` dispatch and the same Puter auth.
