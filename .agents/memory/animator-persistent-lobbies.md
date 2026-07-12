---
name: Animator persistent (official) lobbies
description: How always-on official danger-net rooms (Danger Room, Colosseum) are seeded and protected from reaping.
---

The danger-net relay supports two room tiers: ad-hoc player rooms (cap `MAX_PLAYERS`,
reaped when empty) and **persistent official lobbies** (cap `PERSISTENT_ROOM_MAX_PLAYERS`,
never reaped). The official set is a pure `PERSISTENT_ROOMS` spec in danger-net `types.ts`
(Danger Room→holo/coop, Colosseum→colosseum/pvp) so it stays unit-testable in the
validated danger-net suite (api-server has no vitest).

**Rule:** a persistent room must be excluded from the reap in BOTH paths
(`deleteRoomIfEmpty` *and* the per-tick reaper) and must be re-listed by `publicRooms()`
even when empty, and reset to `seedContent` + `npcs=[]` when its last player leaves.
Miss any one of those and the official lobby either disappears or carries stale
host-owned state into the next visitor.

**Why:** the engine/manager reaps empty rooms aggressively; "official" is a per-room
flag (`persistent`), not a separate collection, so every lifecycle branch that touches
emptiness has to special-case it.

**How to apply:** when adding lifecycle logic to `DangerRoomManager`/`DangerRoom`,
grep for `persistent` and make sure the new branch honors it. Seeded codes are fixed
uppercase (`DANGER`/`ARENA`); collisions with player rooms are impossible because the
manager seeds persistent rooms first and `newCode()` rejects any key already in the map.

**Deploy note:** the relay runs on Railway, not the Replit api-server — these changes
do not appear in the dev preview until the game-server bundle is redeployed (see
`replit.md` Railway section). Dev client targets `VITE_GAME_SERVER_URL`.
