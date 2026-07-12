---
name: Flight/aim controls derive from the camera screen basis, not raw world axes
description: Why chase-cam flight controls (skies cabinet, and any behind-the-ship/3rd-person aim) must be signed against the camera's screen-right/up, not world +X/+Y.
---

# Controls must match the player's SCREEN, not world axes

When mapping input → yaw/pitch for any chase-cam or third-person aim, sign the
input against the **camera's screen-right / screen-up axes**, never against raw
world +X/+Y. The two are usually NOT the same, and "+X looks like right" is the
mistake that ships inverted controls.

**Why:** A Three.js chase cam sits behind the ship and `lookAt`s forward. Its
local +X (screen-right) = `cross(up, eye-target)` normalized. For the skies
cabinet `forwardVec(yaw,pitch)=[sin(y)cos(p), sin(p), cos(y)cos(p)]`, flying
along +Z makes the camera screen-right resolve to world **−X** (the cam is
effectively yawed 180° from Three's default frame). So `yaw+` rotates the nose
toward +X = **screen-LEFT**. The original mapping (`D ⇒ yaw+`, `mouseDx ⇒ yaw+`)
therefore turned the ship the wrong way. Pitch was unaffected because screen-up
stays world +Y, so `pitch+` (=+Y) is genuinely "up = climb" (standard).

**How to derive it (the "rulebook"):**
1. Write `fwd = forwardVec(yaw,pitch)` and the actual chase-cam position/lookAt.
2. Compute screen-right `R = normalize(cross(up, eye - target))` and screen-up
   `U`. Don't assume R = +X.
3. Pick input signs so "press right / mouse-right" moves the nose along +R and
   "press up / mouse-up" moves it along +U (the FPS/"aim like a cursor"
   default). Offer an `invertY` toggle for the vertical-preference crowd; do NOT
   flip a vertically-correct axis just because a user lumps it in with a real
   horizontal bug — fix the proven axis first.

**How to apply / where this kicks in:**
- Fix inversion in the **client input sampling** (`SkiesGame.ts` `sampleInput`),
  NOT in the shared sim. `lib/space-net/sim.ts` + `forwardVec` are the
  deterministic contract the server replays verbatim; changing which key maps to
  which sign is client-only and stays prediction/reconciliation-safe.
- Same principle applies to every behind-the-body camera in this repo
  (third-person voxel player, explorer/racer cabinets): derive turn signs from
  the camera basis, not world axes.
- Sandbox can't validate WebGL feel (Puter guest gate); reason it out with the
  cross-product math, then ask for one manual fly-test.
