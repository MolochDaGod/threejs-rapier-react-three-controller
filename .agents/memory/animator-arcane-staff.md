---
name: Animator arcane-staff / blink teleport
description: How bespoke caster kits hook useSkill and how to teleport the player safely.
---

# Bespoke weapon kits (Soulbinder / Kiter / Striker)

A character-specific signature kit branches in `Studio.useSkill` BEFORE the shared
`skillCooldown` gate, keyed on `def.<flag> && this.weaponId === "<id>" && isSig`
(e.g. `def.arcane && weaponId === "staff"`). Each such kit uses the shared
`sigCooldowns`/`sigCooldownMaxes` arrays (per-slot, HUD-driven) and its own
`<KIT>_SIG_CD/ST` constants — it must NOT consult `skillCooldown`. The kit data is
a pure interface on `CharacterDef` (mirror `KiterKit`); the `signatureSkills[]`
`clip`/`kind` only drive the HUD label/icon since the bespoke handler plays its own
clips.

**Why:** keeps a lingering cooldown from a previously-equipped character/weapon
from blocking the kit, and keeps tuning as data.

# Teleporting the player

**Rule:** a true blink/teleport must go through a controller method that resets
motion state, not a raw `character.root.position` set. `Controller.blinkTo(pos)`
copies the position, clamps it to `this.bound`, and zeroes
`vertical/velocity/extVel` + clears `dashActive` + sets `grounded`.

**Why:** the controller integrates its own velocity/fall state into `root.position`
every frame, so a bare position set inherits pre-blink momentum / mid-dash lerp and
drifts or gets overwritten. (Same reset shape as the `setCollision` spawn branch.)
**How to apply:** reuse `blinkTo` for any instant relocation; for a "leap" that
should respect ground/obstacle collision, prefer `controller.dash(dir, dist, dur)`
instead (it has contact handling `blinkTo` lacks).
