---
name: Animator combat audio (CombatSfx)
description: Spatial WebAudio one-shots + ambient bed in the Danger Room — the non-obvious gotchas.
---

`CombatSfx` plays positional combat one-shots (whoosh/blade/body/heavy/bone/block/somersault)
through a pooled set of `THREE.PositionalAudio` emitters on a `THREE.AudioListener`
mounted on the camera, plus a generated brown-noise ambient bed. Studio owns one
instance; impact categories are chosen by weapon group + finisher flag.

**Gotchas worth keeping:**
- Browsers suspend the AudioContext until a user gesture. `resume()` MUST be called
  from a real gesture handler (wired into Studio's `onClick`/`onMouseDown`). Also
  treat state `"interrupted"` (mobile Safari) like `"suspended"`.
- **Muting must hard-zero a post-mix master gain, not the bed gain.** The breath LFO
  modulates the bed gain's `.gain` AudioParam, so zeroing the bed gain still bleeds
  (the LFO sums around 0). Keep a separate master GainNode after the bed and mute that.
- `StereoPanner` is not universal — feature-detect `ctx.createStereoPanner` and fall
  back to a flat mono chain; wrap the whole ambient init in try/catch since the bed
  is non-essential and must never break startup.
- The engine artifact forbids `@workspace/*` imports; this is self-contained three.js.
  WAVs are imported as `@assets/*.wav` URL strings (vite `@assets` alias → `attached_assets`).
- `setKlaxon(active)` is a synthesized (no-asset) looping alarm for the mech's
  low-integrity warning. It MUST follow the ambient-bed mute pattern: its own
  post-mix master GainNode hard-zeroed on off/mute, with the tremolo/pitch LFOs
  modulating *before* that master. Studio drives it every frame from `updateMech`
  (piloted + health/maxHealth <= 0.25) AND from `cancelMech` (takeover contexts
  like duel spectating early-return the loop, so updateMech may never run again to
  switch it off — kill it there too).

**Why:** audio is WebGL/gesture-gated and offline-unverifiable, so these
correctness traps don't surface in typecheck or headless runs.
