---
name: Animator Voxel LED Mask
description: How the LED Mask "machine god" face is rendered (voxel dot-matrix) and why text never goes on the visor.
---

The "VOXEL LED MASK" door (`src/three/LedMask.ts` + `components/LedMaskMode.tsx`)
renders a hooded cube head whose face is a real volumetric LED dot-matrix, NOT a
flat 2D canvas texture.

**Rule: never draw text on the visor.** Expressions are glyphless (the "matrix"
face is digital *rain*, not literal characters). The scrolling banner has its own
ticker-strip mesh below the chin — it must never be composited onto the face.
**Why:** the user explicitly rejected text-over-faces; they want cinematic
forming transitions instead.

**How the face works:** a single `InstancedMesh` of GW×GH (36×24) emissive voxels,
additive blending + `depthWrite:false`, sitting in front of a near-black visor box
so off-LEDs read as black.

**Depth invariant — the visor must sit BEHIND the LED panel.** The LEDs are
additive but still depth-*tested*, and the visor is opaque, so if the visor's front
face pokes in front of `PANEL_Z` the whole face is occluded and renders "behind the
screen." The visor is a deep box; only its front face (`mask.z + depth/2`) matters —
keep it `< PANEL_Z - cell half-depth`. **Why this is easy to break:** the visor is a
1.5-deep backdrop box, so nudging `mask.z` forward (or `PANEL_Z` back) silently buries
the matrix; always check the front-face math, not the center. Expressions are painted into a Float32 intensity grid
(stamp/ellipse/mouth helpers); eyes blink and the mouth opens on talk/shout via
per-frame `eyeOpen`/`mouthOpen`.

**Forming transition (the whole point):** on `setFace`, snapshot the displayed
buffer into `prevBuf`, draw the new pattern into `targetBuf`, reset `formT` 0→1.
Each cell ignites when `formT` passes its `cellPhase` (radial-from-centre + noise),
giving a sweep that dissolves the old face and re-forms the new one, with an
ignition spark (brief brightness + z-pop) and white-hot core mixing. A bloom glow
plane fakes emissive glow (no post-FX pass exists here).

**Perf/leak gotchas:** ~864 `setMatrixAt`+`setColorAt` per frame is fine, but keep
ALL `THREE.Color` work on cached scratch instances — do not `clone().setHex()` in
the loop (GC churn). Dispose the glow canvas texture and banner canvas texture
explicitly in `dispose()` (the scene-traverse sweep handles geometry/materials).
Engine forbids `@workspace/*` imports; verify with the animator typecheck, not build.

**The face is a living body (damage + cast + personality):** the matrix is driven
by four orthogonal layers stacked in the per-cell loop, not just the expression
buffer. (1) Damage: health 0..1; low health burns out LEDs (a persistent dead
mask rebuilt deterministically from a stable per-cell noise so edges die first)
plus per-hit localized scars that fade slowly, with amber/red colour bleed +
global flicker as health drops; a hit also fires an impact flash + head recoil +
brief grimace. (2) Cast: a charge→release state machine — energy rings spiral
INTO the eyes on charge, then a shockwave ripples OUTWARD on release. (3)
Personality: idle gaze drift/darts offset the drawn eye centres. (4) The existing
expression/forming sweep. **Why these stack instead of being new FaceTypes:**
damage and casting must read on ANY expression, so they're render-loop modifiers,
not painted patterns. Gate the extra per-cell `hypot/exp` to active cast windows
and the per-cell `random()` behind a `health<1`/`dead>0` check.

**Rule: enter cast via `triggerState("cast")`, never `beginCast()` directly** — only
`triggerState` clears prior-state timers/pose. Cast auto-returns to idle and fires
`onAutoIdle` so a host (e.g. `LedMaskMode`) can re-sync its own React state.

**Expressions are a wide, communicative library, not a fixed handful.** Faces are
glyphless procedural patterns painted by `drawFace()` from a small set of primitives
(`stamp`/`ellipse`/`mouth`/`arc`/`heart`/`cross`); adding an emotion is data-cheap.
Adding one is a lockstep edit: extend the `FaceType` union + a `FACE_COLOR` entry +
a `drawFace` case, then surface it in the `LedMaskMode` face grid and (if it's a chat
emotion) in `COMPANION_MOODS`. Keep blink/talk live by routing eyes through `eyes()`
and the mouth through `mouth(sign, mouthOpen, …)`. **Why generic primitives over new
render layers:** expressions are static paintings, so they cost nothing extra; only
cross-cutting effects that must read on ANY face (damage, cast) are render-loop layers.

**The mask is also an AI companion face.** It chats via the EXISTING OpenAI
assistant — reuse `src/ai/useAssistant.ts` (`useAssistant({surface,tools,getSystemPrompt})`),
do NOT add a new endpoint. Persona + emotion protocol live in `src/ai/companionPrompt.ts`
("GRID"): every reply MUST begin with one in-band mood tag then the spoken line. The
mood vocabulary is a single source of truth — `COMPANION_MOODS` drives BOTH the
`parseMood()` regex and the prompt's listed tags, so never hardcode the tag list in
two places (a test asserts every mood parses AND appears in the prompt). `parseMood()`
splits tag vs text; the UI applies the tag via `setFace()` and renders ONLY the
stripped text in DOM chat bubbles (never on the visor — same no-text rule). **Why in-band (not a 2nd model call):** the face reacts
the instant the first token streams. Talk animation is tied to the streaming
lifecycle (`streaming → triggerState("talk")`, else idle). On submit, show a
"scan" thinking face and reset the last-mood ref so the reply re-ignites the face.

**Grid-Y grows DOWNWARD.** The render map is `y3d = ((GH-1)/2 - gridY)*CELL`, so a
larger grid row sits LOWER on the face. Any curved-stroke helper must honour this:
`mouth(sign>0=smile)` puts the curve centre at a LARGER py than its corners
(`py = my + sign*bow`). **Why:** these got inverted once and every curved mouth
rendered upside-down (smiles/love frowned, sad/angry smiled). `arc()` for eyes uses
the opposite sign feel by design — don't "fix" arc to match mouth.

**Eyes follow the cursor.** `setGazeTarget(nx,ny)` (each in [-1,1], y top→bottom)
scales to grid offsets, holds ~2.4s, then eases back to idle drift; pointer gaze is
suppressed while busy (cast/attack). Host wires pointer move/leave on the canvas
wrapper. The hood is a modern "hooded TV-head" (cowl shell + crown + forward brow
brim + emissive trim + side drapes), all children of `head`/`hood` so the existing
scene-traverse dispose sweep frees them.

**Active Mode (live mirror).** Self-contained `src/three/live/` modules (NO @workspace
imports): FaceTracker (MediaPipe FaceLandmarker blendshapes→FaceType+eyeOpen+gaze,
debounced expression), MicLipSync (Web Audio RMS→mouth 0..1), Captioner (Web Speech
API). LedMask gained `setLiveMouth/setLiveEyes(n|null)` overrides used in the update
loop in place of internal blink/talk derivation when non-null. Captions commit ONLY
final phrases to `setBanner` (it resets scroll offset each call, so interim words
would make the ticker restart constantly). **Why a generation token in start():**
each `start()` does multiple awaits (getUserMedia, video.play, MediaPipe fileset +
model); a `stop()` racing those awaits (unmount/toggle-off) would otherwise re-commit
the stream/model/rAF afterward and leak the camera/mic. Fix: bump `startGen` in
`stop()` and each `start()`, acquire into locals, re-check `stale()` after EVERY await
and dispose+bail if stale; only assign to `this.*` once all resources are ready and
the start is still current. Camera/mic usually NotAllowedError in the proxied preview
iframe → tell the user to open the app in a real browser tab.

**Camera is never previewed (by design).** The raw webcam feed is intentionally NOT
displayed — only the AI reads it and drives the LED face. The `<video>` is kept in
the DOM but shrunk to an invisible 1px via `opacity:0` (NOT `display:none`, which
halts playback and starves the face model of frames). UI shows only a green "● Live"
status, never the feed.

**Scrolling banner is OPT-IN (default off).** `LedMask` keeps `bannerOn=false` and a
`bannerStrip` ref; the loop only calls `updateBanner()` when on, and `setBannerEnabled`
hides the strip + restarts the offset. Captions/RUN flip it on so they still scroll.
**Why:** the user found the always-on ticker distracting; it must be silenceable
without breaking the live-caption path.

**Housing shells are swappable & data-driven (`LedMaskShells.ts`).** The outer
housing (formerly the hardcoded hooded TV-head) is now one of N procedural shell
variants in a `SHELLS` registry; each `build(group)` adds meshes to a `shellGroup`
parented to `head` (so it rides idle bob/recoil/cast for free). `setShell(id)`
disposes the old group's geo+materials then rebuilds; choice persists in
localStorage (`ledmask:shell`). **PANEL_Z is now exported from `LedMaskShells.ts`
as the single source of truth** (LedMask imports it) so shells share the
depth invariant. Shell rule: FRAME the face opening, never cover it — frame bars
sit OUTSIDE the opening (x>±0.84, y>0.56/-0.66) so they may poke forward of PANEL_Z
for a recessed-screen look; any piece within the LED footprint must stay behind
the visor (front z < ~1.45). Baked-rig (`CharacterLook.hat="ledMask"`) is NOT wired
to shells — studio only.

**Baked LED look is a separate thing from the live LedMask studio.** The Explorer box
rig (`explorer/rig.ts`) can wear the LED-visor head as a STATIC bake: `CharacterLook.hat
="ledMask"` builds a dark shell (hides the skin head — skip its eyes) + hood/crown/brow
/side-drapes + recessed visor + a draw-once `CanvasTexture` dot-matrix face (additive,
depthWrite:false). NO render loop, NO InstancedMesh — it's plain meshes parented to the
head bone. `CharacterLook.cape` hangs a double-sided cloth box off `mixamorigSpine2`
(world-aligned then tilted). A `CharacterDef.look?: Partial<CharacterLook>` lets a
catalog entry be a styled Explorer variant (see id `led-monk` in `assets.ts`); threaded
through `ExplorerCharacter.load → createAnimatedCharacter({look})`. Baked accessories own
materials/textures OUTSIDE the shared `mats` record, so track them in `extraMats`/
`extraTextures` and free them in `dispose()`. Same visor-behind-LEDs depth rule applies.

**Volume drives delivery, not mood; anger is deliberately rare.** Multiple
drivers feed the mask: camera + AI reply both set the *expression*, while mic
loudness drives the *state* (whisper/talk/shout) — louder speech reads as a
bigger delivery, never as anger. **Why:** the user explicitly rejected "loud =
angry". Keep `angry` reserved (camera classifier gates it behind a hard brow
furrow with a CLOSED mouth so talking/shouting can't trigger it; companion
prompt uses it sparingly) and lean on neutral/mischief/smile as the everyday set.

**Coordination gotcha — reset a change-detected throttle when another driver
takes over the shared target.** The mic→state path only re-applies on a *change*
vs its last-applied value, and it yields to the AI while a reply streams. If you
don't clear that last-applied value on every streaming transition, when streaming
ends the mic sees "no change" and the mask stays stuck idle while you keep
talking. **How to apply:** any time one input temporarily overrides a target that
another change-gated input also writes, reset the gated input's remembered value
on the handoff so it resumes deterministically.

**Stage frames + UI-effects stack decision.** The LED-mask stage can wear one of
16 sci-fi "frames" plus a None option. They are sliced from a single 4x4
reference sheet into `public/frames/frame-00..15.png` (ImageMagick `-crop 4x4@`)
and applied as a **9-slice `border-image` bezel** on `.ledmask-canvas-wrap` — a
transparent solid border whose width insets the canvas, with `fill` painting the
tile centre — so corner ornaments scale without distortion. Selection persists in
localStorage and is coerced to a default if the saved id is stale.
**Why border-image, not background:** `background-size:100% 100%` stretches the
corner ornaments; only 9-slice keeps them crisp at any aspect ratio.
**UI-effects stack — use framer-motion, do NOT add Tailwind to this artifact.**
The animator already ships framer-motion + radix + hand-tuned `index.css`; adding
Tailwind risks the known v4 content-scan OOM and duplicates the styling system.
Build modals/transitions with framer-motion (AnimatePresence) + CSS instead.
