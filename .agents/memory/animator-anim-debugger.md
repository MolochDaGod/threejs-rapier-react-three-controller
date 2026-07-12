---
name: Animator animation debugger
description: Opt-in rig animation recorder + dock panel; how it validates and why it's safe to leave instrumented.
---

# Animation debugger (animDebug singleton + dock panel)

A dockable "Anim Debug" panel logs every animation the rig plays, validating each
clip against the live skeleton, the character's world XYZ, and clip timing.

**Recorder:** `src/three/debug/animDebug.ts` — a module singleton, opt-in
(`enabled=false` by default). Every `record*` method short-circuits when disabled,
so the instrumentation can stay live in production at near-zero cost. Ring buffer
cap 300.

**Instrumentation points (observational only — never change rig control flow):**
- `Animator.action(id)` cache-miss: validate the ORIGINAL clip (via
  `recordValidate`) BEFORE `filterBindableTracks` — the filtered clip is always
  100% bound, so validating it would hide the mesh/skeleton mismatch. Records a
  fail when the clip id is missing.
- `Animator.setActive`: `recordPlay` only when the dominant clip actually changes.
- `ExplorerCharacter.playClipOnce`: `recordVerb` with the verb + world position.

**Gotchas:**
- Validation = bind coverage via `THREE.PropertyBinding.findNode(root, nodeName)`
  over each track's parsed node name. This is exactly what surfaces the
  `THREE.PropertyBinding: No target node found for track: X.quaternion` warnings.
- Log the WORLD position (`root.getWorldPosition(scratch)`), not `root.position`
  (local-to-parent), or coords mislead if the rig is re-parented.
- The panel reads via `useSyncExternalStore`; the recorder MUST return a NEW array
  reference on every change (push builds a fresh array), or React bails out via
  `Object.is` on the snapshot and the feed never updates.
