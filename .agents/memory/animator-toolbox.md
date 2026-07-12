---
name: Animator Toolbox launcher
description: Shell-level 5×5 tool grid; cross-mode panel launches via buffered request bus + pending refs
---

The Toolbox (gold 5×5 grid in the AppShell) launches tools that live in other
modes. Cross-mode launch pattern:

- **Rule:** state owned by App (danger dock visibility, HUD editing, equip
  overlay) is set immediately before `navigate()` — the target mode picks it up
  on mount. State owned by a child mode (Dressing Room dock) must go through a
  buffered request bus (`requestDressingPanel`/`onDressingPanelRequest`): if no
  subscriber is mounted the request is buffered and delivered once on subscribe.
- **Why:** the Dressing Room dock controls only exist inside EditorMode; a
  direct call before the mode switch would be lost. Similarly the equip overlay
  is force-closed on every mode change, so a cross-mode "open loadout" needs a
  one-shot pending ref consumed inside that same reset effect (checked BEFORE
  the reset) or it closes itself immediately.
- **How to apply:** any new Toolbox action targeting child-mode state should
  reuse the bus pattern (buffer-one, deliver-on-subscribe, unsubscribe on
  unmount); any action targeting App state that a mode-change effect resets
  needs a pending ref consumed inside that effect.
