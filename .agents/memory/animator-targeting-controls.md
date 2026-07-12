---
name: Animator combat targeting & lock controls
description: The three-tier targeting scheme (soft-lock / hard lock / block) and its non-obvious wiring constraints
---

# Animator targeting/lock control scheme

Three distinct systems, deliberately separated (don't re-merge block into lock):

- **Soft-lock** (always-on): gentle aim assist. `Controller.softTarget` + a yaw
  nudge that is **cone-gated** (only assists foes within ~60° ahead) and
  **yields to a real flick** (skips when `|mouse.dx| >= 2`). Studio feeds it the
  nearest/Tab-selected enemy each frame via `acquireNearest` when NOT hard-locked.
  Tab cycles the target (re-arms soft-lock); **Alt+Tab** disables it (free cam)
  via `exitSoftLock` → `Targets.clearSelection`.
- **Hard lock** (RMB): a pure **toggle** (`Studio.toggleLock`), not hold. Seizes
  camera+body facing through `setLockTarget`; the per-frame loop refreshes it from
  `lockPoint()` and releases when the target dies.
- **Block** (Ctrl hold): `handleKey` ControlLeft/Right → `startBlock`,
  `onKeyUp` → `endBlock`. **Ctrl+Space = air block** (`airBlock`: hop + keep
  guard). `startBlock`/`endBlock` are decoupled from lock.

**Why / gotchas:**
- RMB used to be hold-block AND lock at once; the user split them. Block no longer
  touches `this.locked`/`setLockTarget` — soft-lock keeps you facing while guarding.
- **Ctrl is a hazardous block key** (Ctrl+W closes the tab, Ctrl+S/A/D etc.).
  Mitigation: App.tsx key handlers `preventDefault()` on ControlLeft/Right. This is
  best-effort — OS-level Alt+Tab and some Ctrl combos may still leak. If the user
  hits problems, rebind rather than fighting the browser.
- Keyboard block must auto-release if pointer-lock is lost (Ctrl key-up gets
  swallowed): update loop calls `endBlock` when `blocking && !blockViaTouch &&
  !input.locked`. `blockViaTouch` flag distinguishes touch-button block.
- `Targets.clearSelection()` is optional on the `CombatTargets` interface (call as
  `?.`); `setSelected` stays private.
