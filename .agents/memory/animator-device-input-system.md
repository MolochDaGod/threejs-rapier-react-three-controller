---
name: Animator device/input UX system
description: How Animator decides phone/tablet/desktop + touch vs mouse, and the canvas/viewport correctness rules that go with it.
---

# Device / input classification

`src/hooks/useDevice.tsx` is the single source of truth for form factor + primary input.

- Detection is **capability-based**, never UA-sniffing and never viewport-width-only.
  Inputs: `(pointer: coarse)`, `(hover: none)`, `(any-pointer: fine)`,
  `(pointer: fine) && (hover: hover)` (= "primary pointer is a mouse"),
  `navigator.maxTouchPoints`, and the legacy `"ontouchstart" in window`.
- `classifyDevice(caps)` is a **pure** function (DOM-free) so it is unit-tested for
  iPhone / iPad / hybrid-laptop / desktop. `detect()` just gathers the live caps and
  calls it. Keep classification logic in `classifyDevice`, not scattered in `detect`.
- **primaryInput**: a real mouse+hover ALWAYS wins (covers touch-screen laptops →
  desktop UX); otherwise a touch screen → `touch`. `touchUI = primaryInput === "touch"`.
- **deviceClass**: mouse-primary ⇒ `desktop`; else split phone/tablet on the
  **shortest screen edge** (`TABLET_MIN_EDGE = 768`) so a landscape phone stays a phone.
- iPadOS 13+ reports `platform === "MacIntel"` with `maxTouch > 1` — that is the only
  reliable iPad tell; folded into both `isIOS` and (via touch caps) the tablet path.
- Shared across the app via `useSyncExternalStore` (one set of media listeners), and
  mirrored to `<html>` as `data-device`, `data-input`, `.is-ios`, `.is-touch` for CSS.

**Why:** the old `useIsMobile()` was `max-width: 767px` only — a small mouse window got
phone touch controls, and an iPad (>768, touch-only) got desktop UI with no joystick.
**How to apply:** drive on-screen controls / `Studio.setTouchMode` off `touchUI`, not
width. Add new device-specific tuning via the `<html>` data-attrs, not new JS branches.

# Canvas / viewport correctness (same task)

- `Studio.resize()` must: guard zero-size (hidden container ⇒ skip, no 0×0 buffer / NaN
  aspect), re-apply `setPixelRatio(min(devicePixelRatio,2))` every call (DPR changes on
  monitor move / zoom), then setSize + camera aspect.
- A `window` resize listener alone misses container-only resizes (panel toggles, the
  canvas-board iframe resizing). Add a `ResizeObserver` on `this.container`; disconnect
  it in `dispose()`.
- Mobile viewport: `index.html` needs `viewport-fit=cover`; CSS uses `100dvh` (not
  `100vh`) for scroll-height panels and `env(safe-area-inset-*)` padding on `.touch-layer`
  so the joystick/buttons clear the notch + home indicator. Note: padding on an
  absolutely-positioned layer insets its children's containing block — that is how the
  safe-area shift reaches the absolutely-positioned touch buttons.
