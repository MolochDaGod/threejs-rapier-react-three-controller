---
name: Animator mesh-fitted weapon collider
description: Weapon blade capsule + Dressing Room collider preview are fitted to the real mounted mesh, not stock per-group radii.
---

## Rule
When a weapon has no hand-authored `hit`, the blade capsule (edgeA/edgeB/edgeRadius) is fitted from the mounted mesh at mount time: geometry is sliced along the blade axis (+Y, mount-local), each slice keeping its own XZ centre + max radius (`MountedWeapon.profile`). The combat capsule centreline follows the mean centre of the blade-region slices (an axe leans into its offset head) and radius = max blade slice radius + a small gameplay pad, clamped to a sane band. Hand-authored `def.hit` (Dressing Room sliders) always wins verbatim.

**Why:** the old stock HIT_DEFAULTS per-group radius drew/tested "arbitrary circles" that didn't match the weapon silhouette — the user explicitly wanted the collider to wrap the mesh.

**How to apply:**
- Sample along triangle EDGES (subdividing long edges per slice), not just vertices — low-poly procedural boxes have corners only at their ends and would leave empty slices otherwise. Lerp-fill interior empty bins.
- The fit runs once per mount inside `addEdgeAnchors` (needs the geometry already parented in the mount-local frame); it works on detached groups because it uses `inverse(group.matrixWorld) * mesh.matrixWorld`.
- Dressing Room preview: green LineSegments wrap from `profile` + dim cyan wireframe capsule = what combat actually sweeps. Keep both — display-only wrap must not imply per-slice combat tests (BladeCollisionSystem still sweeps one capsule).
- If combat feels under-forgiving after this, tune the central pad/min clamp in `addEdgeAnchors`, never per-weapon hacks.
- Regression gate: `src/three/weaponsMeshFit.test.ts` (via the synchronous procedural mount path — no WebGL needed).
