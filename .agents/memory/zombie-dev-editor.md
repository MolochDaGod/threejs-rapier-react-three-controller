---
name: Zombie DEV in-scene editor
description: Gotchas for the TransformControls weapon/character editor + persisted DevConfig in the arcade zombie cabinet.
---

# Zombie DEV editor (arcade cabinet)

An in-scene TransformControls editor for weapon grips, character placement, and
the asset-sourced crosshair, with a persisted `DevConfig`. Two non-obvious rules:

## Yaw must be seeded from the rig, never applied as a default 0
The animated rigs carry a back-to-camera facing correction (a yaw offset set at
spawn). The DevConfig's default `player.yaw`/`ally.yaw` is `0`. **Applying a
fresh (unsaved) config's yaw at spawn zeroes that correction and the characters
face the wrong way.**
- **Why:** defaults are seeded from GRIP/CAMERA, but the yaw correction lives on
  the actor (`getYawOffset`), not in those constants.
- **How to apply:** gate yaw application on `hasSavedDevConfig()`. If a saved
  override exists, apply its yaw; otherwise seed `config.*.yaw` FROM
  `actor.getYawOffset()` so the config round-trips the real facing. Other fields
  (pos, colours, aim height, weapon grips) are safe to apply unconditionally
  because their defaults already mirror the live values.

## Rack slots must be pure translations
Each weapon on the editor rack sits in a slot group that is a pure translation.
This makes the rack weapon's LOCAL transform identical to the hand-local grip
frame, so whatever looks right on the rack bakes 1:1 as the held-weapon
offset/rotation/scale. Don't rotate/scale the slot group or the mapping breaks.

## Misc
- TransformControls in three 0.184 is NOT an Object3D — add `gizmo.getHelper()`
  to the scene, not the controls themselves.
- Editor mode suspends gameplay by early-returning in the animate loop after
  driving orbit + gizmo + crosshair marker + render.
- The crosshair marker is a clone of the weapon's own crosshair-like node
  (regex `/cross|hair|sight|reticle|scope|aim|recti/i`), billboarded to the
  camera with depthTest off so it always reads on top.
