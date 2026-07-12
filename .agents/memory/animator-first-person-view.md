---
name: Animator first-person view + shared aim system
description: How FP camera mode, the vendored AimSystem, and the crosshair hang together in the Animator; the avatar-hide teardown trap.
---

# First-person view + shared aim system

The Animator Controller carries a `viewMode: "third" | "first"`. FP mode hides the
driven avatar (`character.root.visible = false`) and anchors an eye camera with a
full-range look pitch; TP math is gated behind the flag so it stays unchanged.
Toggle key is **KeyB** (KeyV/KeyC were already bound in Studio/App).

**Why KeyB:** the obvious "V for view" was taken (utility kick in Studio, clips
panel in App). Check existing key bindings before picking a toggle.

## The avatar-hide teardown trap (the bug that bit us)
Because FP hides the avatar by mutating the shared avatar's `root.visible`, any
teardown that drops the Controller while in FP must FIRST restore visibility, or
the avatar stays invisible — and in the Playground it leaked across the next play
start too (a fresh Controller defaults to "third" but never forces visible=true).
**How to apply:** in any path that disposes/replaces a Controller (Playground
`stopPlay`, Studio character swap), call `setViewMode("third")` (or directly
restore `root.visible`) before nulling the controller. `setViewMode` early-returns
when the mode is unchanged, so a new TP controller won't redundantly touch it.

## Shared aim math lives in src/three/aim/AimSystem.ts
Engine-agnostic (THREE-only) module: `screenCenterRay`, `applySpread` (uniform
cone), `resolveHitZone`/`damageMultiplier` (head/body zones, close-range bonus),
`raycastScene`→`AimHit` (point/normal/distance/object/zone), `lookAlongNormal`,
`Recoil` (kick/update/reset with pitch/yaw/bloom), `fovKick`. Concepts ported (not
imported) from the Unity Kuvrot/DGS ShootingSystem/CameraController.
**How to apply:** runtime targeting should consume this, not re-derive ray math —
Studio's `crosshairRay()` delegates to `screenCenterRay`. The FOV sprint-kick is
applied in BOTH views by design (sprint feel), not FP-only.
