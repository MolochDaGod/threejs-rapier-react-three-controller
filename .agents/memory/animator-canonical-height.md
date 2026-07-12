---
name: Animator canonical fighter height
description: The single source of truth for rig scale-normalization in the Animator artifact, and what derives from it.
---

# Canonical fighter height

`CHARACTER_HEIGHT_M` (in `artifacts/animator/src/three/types.ts`) is the ONE
height every rig is normalized to (feet-on-floor fit-to-height). It is a value
export (not `import type`) so engine files import it directly.

**Why:** The artifact previously had the magic number `1.8` scattered across
several "normalize model to ~1.8m" sites (Character, ExplorerCharacter,
EditorScene, VoxelEditor). Changing the canonical size meant hunting all of them;
one missed site = inconsistent scale baselines. The user asked for a deliberate
2m fighter and "distances discovered from body size," not magic numbers.

**How to apply:** Any new rig/model normalization must scale by
`CHARACTER_HEIGHT_M / size.y`, never a literal. In `Targets.ts`, body-relative
spacing comes from `SPACING_SCALE = CHARACTER_HEIGHT_M / 1.8` (the 1.8 here is the
*historical baseline* the old tuning was authored against, kept so reach numbers
stay proportional), and `SPELL_RANGE = round(CHARACTER_HEIGHT_M * 10)`. If you
rescale the fighter, sanity-check engage/lunge/spell ranges still feel right —
they move with the constant.
