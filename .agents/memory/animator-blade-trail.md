---
name: Animator blade-trail vs flame-trail
description: Why basic melee swings use a thin ribbon, not the GPU flame trail, in the Danger Room
---

Basic melee swings in the Danger Room use a thin additive **blade-trail ribbon**
(a low-segment quad strip swept grip→tip, modest brightness, age-faded). The
heavy GPU flame-particle trail (1400 additive points) is reserved for
flame-themed skills only.

**Why:** the flame trail emitted every frame on a basic swing read as a
blown-out bloom smear (there is NO post-processing bloom pass — the brightness
is purely additive particle overdraw), washing out the clean slash crescent. The
user wanted a "clean thin animated slash". A dedicated ribbon gives that without
touching the flame system that skills still rely on.

**How to apply:** if you change swing VFX, keep basic swings on the ribbon and
don't re-point them at `flameTrailSegment`. The swing's slash colour is carried
on a `swingColor` field set in BOTH swing entry points (the combo hit and the
clip-driven swing) — set it in any new swing path too, or the ribbon falls back
to the default cyan.
