---
name: Animator offense-fail recovery
description: Player-attacker side of block/parry/dodge — the tempo-loss lockout when YOUR swing is defended.
---

# Player offense-fail recovery (block / parry / dodge)

When the PLAYER's attack is defended, the player must pay a tempo beat so the
defender gets a real counter/escape window. This is the player-attacker mirror of
the already-existing opponent-attacker handling.

## The two sides are independent — don't confuse them
- **Opponent attacks, player defends** (already worked): on player parry/dodge the
  opponent CC gets `applyVulnerableState` → enters `stagger`; `isBusyState()`
  interrupts its AI; its avatar plays a `hurt` one-shot. Lives in `Targets`.
- **Player attacks, opponent defends** (this feature): `Targets.playerHit` returns a
  `DefensiveOutcome`; `Studio.onPlayerHit(result, pos)` reacts. Before this, it only
  reacted on `perfectParry` and imposed NO offense lockout, so the player could
  instantly re-swing — defender got no window.

## The mechanism
- One timer `recoverLock` (seconds). `recoverFromFail(lock, lunge, hitPos)` sets it
  (also bumps `comboLock` and zeroes `comboTimer` to break the chain), and applies a
  small `controller.applyImpulse` along the **player→hitPos** line.
  - `lunge > 0` = forward over-commit (whiffed into the air the dodger vacated).
  - `lunge < 0` = backward recoil (blade rang off a guard/parry).

**Why derive direction from player→hitPos, not a stored swing vector:** the first
cut stored `lastSwingDir` in `scheduleComboHit`, but heavy/skill paths don't go
through there, so they recoiled along a stale direction. `pos` (the defended hit
point) is passed to `onPlayerHit` for *every* offense path, so `hitPos - playerPos`
is always the live, correct attack line. `lastSwingDir` was removed.

## Gate EVERY offense entrypoint or the window leaks
`recoverLock > 0` must early-return from all of: `attack()`, `motionAttack()`,
`stab()`, `doHeavyAttack()`, **and `useSkill()`**. Skills (`KeyF`, `Digit1-4`) deal
immediate damage too — forgetting `useSkill` lets the player skill-cancel out of the
recovery and the defender's window evaporates. Movement stays free (only offense is
taxed). Decrement `recoverLock` in the update loop next to `comboLock`.

**Why shield-break gets NO recovery:** `blockStop` with `defenderReaction === "stunned"`
means the player BROKE the enemy's guard — that's a win, not a fail, so skip
`recoverFromFail` in that branch.

## onPlayerHit fires once per swing
`Targets.playerHit` emits `onPlayerHit` only for the focused defender; AoE splash
uses `hit()` and does not re-emit. So recovery fires exactly once — no double-tax.
