---
name: Animator DJ booth alcove
description: How the resident-DJ scenery actor above the Danger Room door is built and animated.
---

# DJ booth alcove (above the Danger Room door)

A scenery-only feature: Racalvin (char id `gunslinger`, `public/models/racalvin.glb`)
DJs in a lit cut-out above the +Z-wall door, idling to his native clip and bursting
into a retargeted hip-hop dance on a timer.

- **Window-in-wall has no CSG.** The +Z wall (the `i===1` side in `DangerRoom.buildWalls`)
  is rebuilt from FOUR flat panels around a rectangular opening (`buildFrontWall`),
  and the recessed booth box (`buildDjAlcove`) is plain planes/boxes behind it. To
  move/resize the window, edit the `djWin*` / `djFloorY` / `djDepth` fields in lockstep —
  panels, alcove, neon frame, lights and `djBoothAnchor` all derive from them.
- **Scenery actors can reuse the GLB retarget pipeline without the Character class.**
  `DjBooth.ts` plays a mixamorig FBX (`hip-hop-dancing.fbx`) on Racalvin's real rig via
  `retargetLibraryClip(target, source, raw, buildRetargetNameMap(targetBoneNames))` —
  the same path EditorScene/Character use. Idle comes from Racalvin's OWN native GLB clip
  (binds by node name, no retarget). Call `target.skeleton.pose()` after a single
  `retargetLibraryClip` to restore the bind pose (the batch `retargetLibrary` already does this).
- **Facing:** Racalvin's `modelYaw = Math.PI` makes him face -Z (into the room). The DJ
  sets `rotation.y = facing` (default PI). Flip to 0 if he ends up facing the back wall.
- **Why deferred UI overhaul:** the live preview harness can't keep the heavy animator
  vite process alive (logs "ready" then dies; screenshot tool throws `river CANCEL`).
  Verify code via `pnpm --filter @workspace/animator-app run typecheck`; visual features
  can't be screenshot-verified in-session.
