---
name: Animator PvP server authority
description: How head-to-head Danger Room duels are made cheat-resistant without full server resim.
---

# Danger Room PvP server authority

Full Rapier+epicfight re-simulation server-side is infeasible (per the danger-net
design notes), so PvP authority is a **server-owned-HP + validated-hit** model that
mirrors the carrier/space "server owns HP, applies damage, broadcasts" pattern —
NOT a full authoritative character sim. Positions/hits are still *reported* by
clients but the server validates and clamps them.

**Where authority lives:** the relay room (`artifacts/api-server/src/game/danger-room.ts`)
holds per-player `hp` + timing/position state and is the sole authority in `pvp`
mode. The shared pure helpers live in `lib/danger-net/src/sim.ts`
(`resolvePvpDamage`, `guardFactor`, `clampDamage`, `clampMove`, `sanitizeGuard`).

**Rule:** a client-claimed PvP `hit` is only honoured if BOTH fighters exist /
distinct / alive, the attacker swung within the attack window, the per-attacker
rate limit hasn't been violated, and the victim is within range of the attacker's
*teleport-clamped* server position. Damage is then capped + mitigated by the
victim's reported `guard` and applied to server HP; the resolved hit (with
`outcome`) is broadcast to everyone.

**Why guard is victim-reported + avoid-gated:** we can't resim defenses, so the
victim reports a coarse `GuardState` (open/block/parry/dodge). block = chip
(`guardFactor` 0.35), parry/dodge = full negate BUT only when
`now - lastAvoidAt >= PVP_AVOID_COOLDOWN_MS` — otherwise a client claiming a
permanent parry/dodge would be godmode, so on cooldown the hit lands full.

**Coop is unchanged:** coop has no friendly fire and NPC health stays
host-authoritative; the server only trusts client HP in coop.

**Client coupling (`artifacts/animator/src/three/Studio.ts`):** in pvp the loop
must NOT overwrite `this.health` from the local CC — it is read back from the
authoritative snapshot's own `PlayerState.hp`. A self-hit combat event plays
VFX/recoil ONLY (no local HP decrement, or it double-counts). Death/respawn are
server-driven: `defeatPlayer(auto=false)` skips the local auto-respawn schedule,
and `restorePlayer()` runs on the server `respawn` event / authoritative
`alive` flag. Any CC-health `<=0` defeat triggers must be gated behind
`net.mode !== "pvp"`.

**Anti-teleport:** `clampMove(prev,next,dtSec)` allows `MAX_MOVE_SPEED*dt + 4`
(fixed slack absorbs a laggy report or legit dash) and pulls over-long jumps back
along the movement direction; the clamped position is what's stored AND
rebroadcast, so range-checks can't be spoofed by a blink.

## Local reaction clips that self-schedule recovery
A player reaction clip that internally schedules its own `getUp`/recover (e.g.
`knockedOut`, `knockBack`) must only be triggered on the LOCAL auto-respawn death
path. In `defeatPlayer(auto)`, fire such reactions AFTER the `if (!auto) return`
guard — for pvp/server-authoritative deaths (`auto=false`) the server owns
respawn, so a local self-recovering reaction would visually revive the player
before the server's respawn event.
