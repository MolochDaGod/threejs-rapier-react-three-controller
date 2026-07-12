---
name: Animator Playground Play HUD + weapon skills
description: How the Dressing Room "Play" game HUD (vitals + weapon-skill bar) and its cooldown loop are wired.
---

# Dressing Room Playground — Play-mode game HUD + weapon skills

When Play starts in the Dressing Room (EditorScene), a game-style HUD shows a
(cosmetic) health bar + a weapon-skill bar (LMB + 1-5) with cooldown sweeps.

- **Kit is weapon-aware, data-only.** `playSkills.ts` maps each `WeaponGroup`
  to a 6-slot kit (primary + skill1..5). `EditorScene.resolvePlayGroup()` picks
  the group: a driven grudge character maps from its preset `animPack`
  (magic→magic, longbow→ranged, sword_shield→melee-1h, else unarmed); the dressed
  rig uses its equipped weapon's `group`. Add skills by editing the kit table.
- **Cooldowns live in the engine as timestamps**, not counters: `fireSkill()`
  stamps `skillReadyAt[key] = now + cd*1000` and re-emits the snapshot only on a
  fire. The HUD (`PlayHud.tsx`) interpolates the sweep itself via rAF.

**Why / gotcha:** the cooldown rAF MUST be demand-driven — start it only when a
slot is *actually* cooling (`cooldown>0 && readyAt>now`) and let it self-stop
when all are ready. Gating on `skills.some(s=>s.cooldown>0)` is a bug: every kit
slot has a non-zero cooldown, so that predicate is always true and the loop
churns React at 60fps for the whole Play session even when nothing is cooling.

**Scope:** this is a HUD shell + skill VFX driver. There is no damage/enemy sim;
`health` is a constant full bar. Skills fire the existing `playVfx` + the
weapon-appropriate `attack` role. Grudge anim packs only ship idle/walk/run/
attack(+sprint) — no jump/hurt/block/death clips exist, so jump stays a graceful
idle fallback.
