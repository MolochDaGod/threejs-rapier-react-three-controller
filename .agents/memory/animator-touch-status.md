---
name: Animator touch controls + status FX
description: Mobile on-screen controls and the self-contained status-effect layer in the Animator (Danger Room) artifact.
---

- Conditionally-mounted on-screen touch controls must reset **all** latched
  virtual input (move=0, lookEnd, sprint=off) in their React unmount cleanup —
  not just the obvious one.
  **Why:** the controls are gated like `{isMobile && !panelsOpen && <TouchControls/>}`,
  so opening a panel mid-touch unmounts them before pointer-up/cancel fires; any
  axis left set stays latched in the engine InputState and the character keeps
  moving/looking. (Caught only in review, not by typecheck.)
  **How to apply:** any input bridge that pushes state into a long-lived engine
  from a component that can unmount while a pointer is down needs a full reset on
  unmount, keyed off the live api via a ref.

- Analog joystick blends ON TOP of keyboard in the Controller: gate the analog
  path on `moveX/moveY != 0` so desktop keyboard stays full-speed (unit vectors);
  only the stick scales speed by push magnitude.

- The status FX (auras + notifier + dock) is built directly on three.js
  in-artifact. Keep a pure-data menu export (css color strings, glyphs) so React
  dock/HUD never touch THREE objects. (Note: the old "forbids @workspace imports"
  claim is obsolete — the artifact imports `@workspace/{epicfight,api-client-react,
  danger-net}`, including in `src/three/`; see project-consolidation-animator.md.)
