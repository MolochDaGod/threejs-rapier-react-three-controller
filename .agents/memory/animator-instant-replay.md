---
name: Animator instant replay
description: How A.L.E. duel instant replays record + re-pose real fight frames decoupled from live combat.
---

# Animator instant replay (A.L.E. duels)

Sports-broadcast style instant replay for AI duels: a rolling buffer records each
fighter's full pose every frame, then re-poses the REAL recorded frames in slow-mo
(not a re-simulation) before resuming live combat.

## Design rules that matter

- **Pose = root world transform + every skeleton bone's LOCAL pos+quat.** Scale never
  animates on the Explorer rig, so it's skipped. Bone order is cached once by traversing
  `animator.character.skeletonRoot` (filter `isBone`); the order is stable for the rig's
  lifetime and keys the flat `Float32Array` (7 floats/bone). Mounted weapon GLBs are NOT
  bones — they ride the hand bone automatically when bone transforms are set.
- **Replay must capture the live pose at start and restore it verbatim at end.**
  **Why:** a living fighter's mixer time is untouched (so it self-corrects), but a DEAD
  fighter's `root.position` is driven by nothing after death — replay moves it, so without
  restoring the exact pre-replay pose the corpse drifts to wherever the replay left it.
- **Replay is fully decoupled in the host loop.** When `ale.isReplaying`, Studio.loop
  early-returns BEFORE the normal path: no duel/targets/AI/physics/vfx update, only
  `ale.updateReplay(dt, views)` + camera + render + HUD. The duel timer is frozen during
  replay, so it resumes exactly where it paused.
- **applyCamera must apply when replaying even if cameraMode is "off".** Replay forces a
  cinematic camera (director) when the user is on the free/player view and restores the
  prior mode on finish.
- **Recording happens during `fighting` AND `result` phases** so the KO + death animation
  land in the buffer. Auto-replay waits a short delay after the trigger event so the
  decisive blow records before playback starts.
- **Auto-replay triggers on KO _and_ high-excitement mid-round highlights (crit/parry/big hit).**
  KO always fires (it's the finish) and bypasses the cooldown; mid-round highlights only fire
  when the director's excitement is past a threshold AND a post-replay cooldown has expired.
  **Why:** without the excitement gate + cooldown, busy exchanges fire back-to-back replays
  and the duel becomes mostly slow-mo. **How to apply:** the cooldown is armed in
  `finishReplay` (counts from when a replay ENDS, not starts), so it naturally throttles only
  the auto path — manual `startReplay()` and the KO finish are never blocked by it. One shared
  `autoReplay` toggle still governs the whole behaviour.

## Verification

WebGL is unverifiable in the sandbox. The ring buffer + frame sampling
(`ReplayBuffer`, `sampleFrames`) are pure and renderer-agnostic on purpose — unit-tested
in `src/three/ale/replay.test.ts` with a fake `PoseRecordable`. Pose capture/apply on the
rig itself can only be eyeballed in the browser.
