---
name: Animator GLB sub-clip combos
description: How to split one GLB combo animation into per-click combo hits, and why combo[] entries are lighter to add than VERBS one-shots.
---

# Slicing a single GLB combo into per-click hits

A GLB whose ONE animation contains several swings can be exposed as separate,
click-advanced combo hits without touching the engine: in the explorer `loader`,
a fraction-based sub-clip registry maps synthetic clip ids → `{parent, from, to}`
(fractions of the parent's POST-trim duration), and the GLB loader slices them
from a once-loaded/retargeted/wind-up-trimmed parent via
`THREE.AnimationUtils.subclip`.

Key facts / gotchas:
- `AnimationUtils.subclip` clones the source before trimming, so reusing one cached
  parent clip for N concurrent sub-clip slices is safe (no source mutation).
- Cache the parent as the in-flight PROMISE (keyed by id) so the full clip + all
  sub-clips share ONE fetch under `loadClips`' concurrent `Promise.all`. Evict the
  entry on promise rejection so a transient failure doesn't permanently poison it.
- Synthetic sub-clip ids must be added to `GLB_CLIP_IDS` (routes them through the
  GLB path + full-clip endFactor) even though no `.glb` file backs them — the
  loader resolves them via the sub-clip registry, never the filesystem.
- Even-thirds is a fine default split; impact-frame alignment is a manual tuning
  pass (adjust the fractions), not a correctness issue.

# Why adding a combo clip is lighter than a VERBS one-shot

**Rule:** to add/replace a melee combo, you only need an `ActionKey` + a weapon
set `actions` entry + the key in that set's `combo[]`. You do NOT need the
`VERBS`/`playClipOnce`/dedicated-`Animator`-method plumbing that a new one-shot
verb requires.

**Why:** `Animator.nextComboClip()` cycles `WEAPON_SETS[weapon].combo[]` and
resolves each entry through `resolve(key) = actions[key]` → `playOnce(id)`. That
path is independent of the `VERBS` whitelist used by `playClipOnce`. Retiring a
weapon's old attack-based `combo[]` while leaving its `attack*` actions defined
keeps action-slot/override usage working and breaks nothing.

**Parry/block stance** is likewise data-only: `block(true)` → `holdClip()` returns
`resolve('blockIdle') ?? resolve('blockStart')`, `hasRole('block')` is hardcoded
true, and Studio's RMB calls `startBlock()` for every weapon. So a weapon gains a
working guard just by adding `blockStart`/`blockIdle` clips; parry timing window +
parry-react flourish are weapon-independent.
