---
name: Skyfall apex / pending barrage
description: Why an apex-gated airborne ability must cancel competing aerial states and carry a fail-safe timer.
---

# Skyfall apex-gated barrage

An aerial ability that defers its payload until the launch apex (Controller reports
the apex once via `consumeApex()`, Studio fires the barrage on that frame) must guard
two things:

- **Cancel competing aerial states on launch.** The apex is only detected inside the
  normal gravity branch of the Controller update. If another aerial special (hover /
  spin / flip / dash / roll) is active, that branch is skipped and vertical velocity is
  zeroed there, so the apex is never reached. `skyLaunch()` therefore force-clears all
  of those flags before arming.
- **Carry a fail-safe timeout on the caller's pending flag.** The barrage is gated by a
  `skyfallPending` flag; if the apex is somehow never reported, that flag stays true and
  the cooldown/pending guard deadlocks every future cast. Pair it with a short timer that
  fires the barrage (and clears pending) if the apex never arrives.

**Why:** removing the grounded gate (to allow mid-air casts) exposed both failure modes —
casting during hover/spin meant the apex never fired and the ability soft-locked.

**How to apply:** any time you make an apex/event-gated ability castable from more states,
audit which update branch sets the gating event and ensure the launch cancels the states
that would bypass it, plus a timeout on any "pending payload" flag.
