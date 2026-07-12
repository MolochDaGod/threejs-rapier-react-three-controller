---
name: Animator unified app shell + global AI dock
description: How the phone-first shell wraps every mode and how the single AI companion is sourced per surface
---

# Animator app shell + global assistant

`AppShell` (src/components/AppShell.tsx) is a persistent overlay (NOT a layout
box) wrapping every mode's content. It renders the mode children unchanged
(each mode keeps its own fixed/absolute full-screen layout) plus two overlays:
a top-center launcher pill + nav (bottom sheet on phones, dropdown on pointer
devices) and exactly ONE `AiAssistant` dock.

**Single-dock rule:** there must be only one `<AiAssistant>` mounted at a time —
the shell's. Do NOT add per-mode `<AiAssistant>` mounts (they were removed from
App's danger branch and from EditorMode); duplicates = two FABs + split convos.

**Where each surface's assistant config comes from:**
- App computes `shellAssistant` per mode and passes it as `AppShell.assistant`:
  danger/play → Danger Room master (live tools); doors/voxel/lobby → calm
  "guide" companion (`appGuideSystemPrompt`, no tools); editor/ledmask → null.
- A mode that owns its engine registers its own config via
  `useRegisterAssistant(config, deps)` (src/ai/AssistantSurface.tsx). The shell
  prefers a child-registered override over the host-passed base. EditorMode uses
  this because it alone holds the EditorScene engineRef.
- LED Mask is special: `AppShell.hideAssistant` is true for it, because it runs
  its own embedded face chat (the chat drives the voxel face), so the global
  dock is suppressed there.

**Why this split:** lifting the editor engine up to App just to build its tools
was uglier than a tiny registration context; danger tools already live in App.

**Voice ("Talk to AI"):** `useVoiceChat` (src/ai/useVoiceChat.ts) reuses the LED
Mask `Captioner` (Web Speech STT, Chromium-only) for mic→input+autosend and
`speechSynthesis` for reading replies aloud; both feature-gated so the dock is
text-only where unsupported. Wired into AiAssistant behind a `voice` prop
(default on); buttons only show when the matching capability exists.

**Movable shell chrome (UI edit mode):** the launcher + Toolbox + edit toggle
live in ONE fixed top-center `.shell-topbar` flex row (the Toolbox pill must NOT
be its own fixed element — it used to float top-left over mode text). A Move
toggle enters edit mode: topbar / wallet pill / AI dock become draggable;
per-element `{dx,dy}` offsets persist to localStorage (`dangerroom:uilayout`)
and apply as `--ui-dx`/`--ui-dy` CSS vars added to each element's transform, so
all-zero renders byte-identical to stock. Key constraints:
- Wallet + assistant are wrapped in `display:contents` divs that carry the vars
  (custom props inherit through contents) + capture handlers; contents boxes
  can't setPointerCapture, so drags use window-level pointermove/up listeners.
- While editing, `onClickCapture` swallows activation; clamp offsets on load,
  drag AND window resize (re-clamp + persist) so nothing strands off-screen.
- The desktop nav popover must receive the same topbar vars (its CSS anchors
  via `calc(50% + var(--ui-dx))`) or it detaches from a moved bar.
- Pure layout logic (clamp/merge/load/save) stays DOM-free in
  `components/shell/uiLayout.ts` and is unit-tested (vitest env is node-only).

**Gotcha:** App wraps each return branch in a local `shell()` helper, so AppShell
remounts on mode change — fine because assistant convos persist by `surface` in
useAssistant storage. The shell overlays sit at z-index 710-720, above the touch
control layer (z 600), so the launcher + AI FAB stay tappable on phones.
