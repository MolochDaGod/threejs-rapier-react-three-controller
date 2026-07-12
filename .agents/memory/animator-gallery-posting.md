---
name: Animator Gallery / posting
description: How posted creations map to PostKind and which ones round-trip into the editors.
---

# Animator Gallery (Lobby) posting & loading

Posts (api-server `posts` table) carry a `PostKind` of only `scene | dungeon`.

- **Voxel maps always post as `kind: "dungeon"`** (NOT branched on the map's
  `dungeon` boolean). The arena-vs-dungeon distinction is preserved inside the
  payload's own `dungeon` field; the PostKind is used purely to mark "this is a
  loadable/playable voxel map".
- **Scene Editor scenes post as `kind: "scene"`.**

**Why:** with only two PostKinds, mapping all voxel maps to `dungeon` keeps the
Gallery's load logic unambiguous — `dungeon` posts are voxel maps loadable via
`VoxelEditor.load()` and playable; `scene` posts are Scene Editor exports.

**Round-trip gap:** `EditorScene` has `exportJSON()` but no `importJSON()`, so
`scene`-kind posts are listed **view-only** in the Lobby — they cannot be
reopened. Voxel/`dungeon` posts load fine. Adding `EditorScene.importJSON` is the
follow-up to make scene posts loadable (imported GLB/FBX bytes aren't embedded in
the JSON, so only procedurally-rebuildable parts round-trip).

**How to apply:** loading a gallery map into the editor uses a `pendingMapRef` in
`App.tsx` that the voxel-mount effect applies on next mount; playing uses the
existing `playMapRef` + `setMode("play")` path. Auth for posting is bridged in
`ClerkSetup.tsx` (`ApiAuthBridge` wires Clerk `getToken` -> `setAuthTokenGetter`).
