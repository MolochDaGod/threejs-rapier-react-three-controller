---
name: voxel-item content conventions
description: Item-id naming + crafting/persistence invariants for the Game Studio play-mode item core (artifacts/voxel-engine engine/items/).
---

# Item content conventions (voxel-engine play mode)

## Item ids are `${mat}_${cls}`, NOT the display label
Tools/armor are generated as `wood_pickaxe`, `stone_axe`, `iron_helmet`, etc. The
"Wooden"/"Stone" wording (`MAT_LABEL`) is **display name only**. Any new
`STARTER_KIT` entry, recipe input/output, or hand-written id must use the real
generated id.

**Why:** `Inventory.fromData()` validates every stack against the ItemRegistry and
*silently drops* unknown ids. A mismatch (e.g. `wooden_pickaxe` vs `wood_pickaxe`)
isn't a crash — the item just vanishes on the first save/load round-trip, so it's
invisible in dev until you reload a project.

**How to apply:** when adding items/recipes/starter gear, cross-check the id
against what `buildTools`/`buildArmor` actually emit. `Inventory.test.ts` has guard
tests that assert every STARTER_KIT and recipe id resolves in the registry — keep
them green.

## Persistence must preserve `dur`
`Inventory.toData/fromData` carry per-stack `dur` (tool/armor durability) in both
directions. Dropping it resets wear on every save/load.

## `craft()` is atomic (snapshot + rollback)
`craft()` snapshots the inventory, consumes inputs, adds the output, and rolls back
(restores the snapshot, returns false) if any output overflows.

**Why:** consuming inputs frees slots, so a pre-check of "does the output fit now?"
is both wrong (rejects valid crafts) and dangerous (a cheap `canAccept` that only
checks "room for ≥1" burns the inputs and drops the overflow output). Consume-first-
then-verify-and-rollback is the only correct ordering.
