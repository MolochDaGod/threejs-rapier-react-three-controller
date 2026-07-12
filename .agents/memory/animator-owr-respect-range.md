---
name: Animator OWR respect-through-range combat
description: How the Optimal-Weapon-Range consequence system is structured and the timer-overlap rules it must obey
---

# Respect-through-range (OWR) combat

A per-weapon Optimal Weapon Range model drives positioning consequences for both
the player and AI. The pure math lives in `combat.ts` (`weaponOWR`,
`classifyEngagement` → `RangeVerdict`) and is unit-tested in `combat.owr.test.ts`.
Outcomes: clean / spacingDisadvantage / penetrationSuccess / penetrationFail /
whiff, each with a `damageMul` + flags (staggerLock, freeCounter, exposeWindow,
slowmo).

**Rule: apply the verdict `damageMul` UNCONDITIONALLY on a basic swing** (player
and AI). A `whiff` verdict has `damageMul 0`, so leaning on geometry/AoE falloff
to soften an out-of-band swing instead of the multiplier breaks the player↔AI
symmetry. Telegraphed skill/AoE swings are exempt — they keep authored damage.

**Why timers must be token-gated:** several consequences mutate global feel state
(`setTimeScale` for penetration slow-mo, `Controller.setSpeedMultiplier` for the
penetrationFail expose window) and schedule a delayed restore. Overlapping breaches
or fails will otherwise let an earlier restore run after a later effect and strand
the state (stuck slow-mo, expose ending early). Each effect uses a monotonic token
("latest-issued restore wins") and slow-mo captures its base time-scale only when
none is active, so the final restore returns to the true pre-effect value.

**Respect timer (defender advantage):** a successful player defense
(`isDefended`) opens a short `respectWindow`; the next swing inside it is a 1.5×
COUNTER. It must be consumed **only on a confirmed landed hit** (hit/crit), never
at schedule time — otherwise a whiffed/blocked counter wastes the window.

Distance-scaled block safety: while blocking, incoming damage scales by where the
attacker sits in the player's defensive OWR (inside optimal = crowded/worse,
in-band = safest, at reach = fairly safe).

Reticle cue: `HudSnapshot.owrRange` ("close"/"optimal"/"far"/"none") set per-frame
from the nearest enemy drives the Crosshair ring + a tiny self-contained WebAudio
edge beep (engine audio is limited to speechSynthesis + this blip; no external TTS).
