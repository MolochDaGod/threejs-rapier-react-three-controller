---
name: Project consolidated to Animator
description: The repo was reduced to a single flagship app (Animator); other game artifacts were deleted. Explains why many memory topic files are now historical.
---

The project was consolidated down to the **Animator** app as the sole flagship.

**What was deleted:** the `voxel-engine` (Game Studio, was at `/`), `arcade`
(Voxel Arcade hub + all its cabinets), and `carrier` (multiplayer game) artifacts.

**What was kept:** `animator` (promoted from `/animator/` → `/`), `api-server`
(`/api`, retained backend — still depends on the `space-net`/`carrier-net` libs),
`mockup-sandbox` (`/__mockup`, canvas tooling), and all `lib/*`.

**Why:** the user wanted everything refocused on the Animator as "the ultimate
resource & AI tool for games, camera, editor, and effects" (three.js + Rapier,
with three/r3f/spline/playcanvas/node as future directions).

**How to apply:**
- Many `.agents/memory/*.md` topic files (voxel-*, arcade-*, explorer-*,
  carrier-*, zombie-*, and several animator entries describing voxel-engine
  integration) describe **deleted code**. Treat them as historical — verify the
  referenced files still exist before relying on them.
- Deleting an artifact directory auto-unregisters the artifact AND removes its
  managed workflow. `removeWorkflow` is REJECTED (PROHIBITED_ACTION) for
  artifact-managed workflows — just delete the dir.
- Animator reads its base from `import.meta.env.BASE_URL` (Vite `base` ←
  `BASE_PATH` env), so moving previewPath only required editing `artifact.toml`
  (previewPath + service paths + `BASE_PATH`), no code changes.
- **"Animator forbids @workspace imports" is OBSOLETE.** Many topic files still
  repeat it. Reality: the artifact imports `@workspace/{epicfight,api-client-react,
  danger-net}` freely — including inside `src/three/` (Studio, Targets,
  SparringCombat, …). The ONLY standing rule is that the Explorer rig + its FBX are
  vendored/self-hosted rather than pulled from `@workspace/animator` /
  `@workspace/assets`. Do not strip the valid workspace imports that exist today.
