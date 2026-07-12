---
name: Animator combo attack-clip choice
description: Why a single LMB can look like a full slow combo — the combo state machine replays the same attack-role clip every stage.
---

# Combo replays ONE attack-role clip per stage

`Studio.doComboHit(stage)` does NOT pick a different clip per stage — it always
plays the character's `attack` role clip (or `overrides.primary`); `stage` only
changes VFX/force/finisher. So the visual "3-hit combo" is really the SAME clip
played on each of the 3 clicks.

**Consequence:** if a character's `attack` clip is itself a multi-swing/combo
animation, a *single* LMB plays that whole long sequence — it looks like a slow
auto-combo the player never asked for.

**Rule:** the `attack`-role clip for a melee char must be ONE short snappy swing,
not a baked multi-swing combo. Save the long combo clips for signature skills.

**Why:** grudge6 GLBs ship both `sword_attack_a` (~3.5s, multi-swing) and
`sword_attack_c` (~1.3s, single swing). Knight/Warrior kits originally used
`sword_attack_a`, which is what made one click look like a slow 3-hit combo;
switching to `sword_attack_c` makes each click a clean single hit that still
chains via the combo state machine.

**How to apply:** when a melee attack "feels like an unwanted combo", check the
duration of the mapped `attack` clip (parse the GLB) before touching the state
machine — the fix is usually a single-swing clip id in the kit's `clips.attack`,
not code.
