---
name: Animator controls persistence + uniform mouse feel
description: Why the controller/camera/mouse "feel" settings must persist to storage and be re-read at mount, and the remount clobber trap.
---

# Animator controls persistence + uniform mouse feel

The controller/camera/mouse "feel" settings group (the Editor-panel knobs) is
persisted like every other settings group; it used to be the lone group that reset
on reload.

**Decision: the per-character facing offset must NOT be persisted.**
**Why:** it is tuned per rig, so a saved value would leak onto the next character.
**How to apply:** load/save helpers reset it to default; never round-trip it.

**Decision: storage is the single source of truth, re-read at every mount — UI
state must never be pushed into a freshly-created engine on mount.**
**Why:** the engine mutates camera zoom OUTSIDE React (wheel-zoom writes straight
onto the shared params ref each frame), so React state never sees zoom changes.
Pushing stale React state into a freshly-loaded engine clobbers the persisted
value and re-saves the stale one. This cost two review rounds to get right.
**How to apply:** the engine loads settings in its constructor, saves on explicit
change, debounce-saves engine-only drift from the loop, and flushes pending saves
synchronously on dispose. The host mount effect re-reads from storage, syncs that
into UI state, and applies it to the engine — it does not push prior UI state.

**Decision: non-combat surfaces read the same shared mouse feel (sensitivity +
invert) rather than hardcoded local speeds, for cross-mode uniformity.**
**How to apply:** when adding a new control field, update the persistence
load/save, its clamp range, and the matching settings-panel slider in lockstep.
