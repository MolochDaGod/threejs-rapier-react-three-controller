---
name: Danger Room collision + impact VFX gotchas
description: Why the Danger Room null-collision path needs obstacle push-out, and why impactExplode whites out the screen if uncapped.
---

# Danger Room interior collision (null path)

The default Danger Room runs `Controller` on the `setCollision(null)` path, which
only clamps to the outer room bound (`±roomBound`, lifted to ~1e5 when a real
collision provider is set) and the Y=0 floor. It has **no interior colliders** —
the player walks through pillars, training dummies, and live opponent NPCs.

Fix pattern: a `Controller.setObstacles(() => {x,z,r}[])` callback, polled every
frame inside `move()` **guarded by `!this.collision`** so the dungeon/arena Rapier
KCC path is never touched. Studio rebinds the callback after every controller
(re)creation (the controller is recreated on each character swap), and the
callback reads `this.room`/`this.targets` live so it survives target swaps.

**Why two resolution passes:** a single radial circle push-out followed by the
hard wall-clamp re-penetrates **corner** obstacles — the very corner has no
walkable space, so clamping shoves the body back inside the pillar and it jitters.
Pass 2 detects residual penetration and slides the body **along the wall** to the
nearest in-bounds point that clears the circle (solve the free axis from
`minDist² - dPinned²`, keep only in-bounds candidates, pick nearest). Open-floor
approaches are handled smoothly by pass 1 alone.

# Every additive point-sprite shader with a 300/-mv.z size term MUST clamp gl_PointSize

This applies to **all** of Vfx's GPU particle shaders, not just impactExplode:
the per-hit burst (`impactExplode`) *and* the continuous weapon **fire trail**
both compute `gl_PointSize = aSize * uSizeMult * ... * (300/-mv.z)`. The
`300/-mv.z` perspective term makes size explode as a particle approaches the
camera, so a near-camera sprite blows up to ~1500px and whites out the screen.

**Why:** impactExplode whited out on every LMB; later the fire trail produced the
same blinding-light flash when a flaming weapon swung past the third-person camera
(reported via gif). Fixing one shader is not enough — any new additive point
shader added to Vfx with this size formula will reproduce it.

**How to apply:** wrap the size in `min(..., 64.0)`. The cap only affects
near-camera particles; distant ones are already small. Keep counts/sizes modest
and scale output alpha down. Grep `gl_PointSize` in `src/three/Vfx.ts` after
adding any particle system to confirm every one is clamped.
