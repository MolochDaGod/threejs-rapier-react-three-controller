import * as React from "react";

/**
 * Unified device + input detection for the Animator UI/UX system.
 *
 * Rather than UA-sniffing (which mislabels iPadOS as desktop Safari and breaks on
 * hybrid laptops), this reads the platform's own capability media queries
 * (`pointer`, `hover`, `any-pointer`) plus `navigator.maxTouchPoints`. That is the
 * robust, framework-free way to answer the only questions the UI actually cares
 * about: "is the primary input a finger or a mouse?" and "how big is the screen?".
 *
 * It exposes a single live snapshot via `useDevice()` (backed by
 * `useSyncExternalStore`, so every component shares one set of media listeners),
 * and mirrors the result onto `<html>` as `data-device` / `data-input` / `.is-ios`
 * / `.is-touch` so plain CSS can adapt too.
 */

export type DeviceClass = "phone" | "tablet" | "desktop";
export type PrimaryInput = "touch" | "mouse";

export interface DeviceInfo {
  /** Coarse form factor, derived from input capability + shortest screen edge. */
  deviceClass: DeviceClass;
  /** What is actually driving the cursor right now. */
  primaryInput: PrimaryInput;
  /** Show on-screen joystick/buttons instead of relying on mouse + keyboard. */
  touchUI: boolean;
  /** The device has a touch screen at all (may still be mouse-primary). */
  isTouch: boolean;
  /** iPhone / iPad / iPod, including iPadOS that reports itself as a Mac. */
  isIOS: boolean;
  /** A mouse, trackpad, or stylus is available. */
  hasFinePointer: boolean;
  width: number;
  height: number;
}

/** Shortest-edge px at/above which a touch device is treated as a tablet. */
export const TABLET_MIN_EDGE = 768;

/** Raw platform capabilities, gathered once then classified by a pure function. */
export interface DeviceCaps {
  width: number;
  height: number;
  /** `(pointer: coarse)` — the primary pointer is imprecise (a finger). */
  coarse: boolean;
  /** `(hover: none)` — the primary pointer cannot hover. */
  noHover: boolean;
  /** `(any-pointer: fine)` — *some* precise pointer exists (mouse/trackpad/stylus). */
  anyFine: boolean;
  /** `(pointer: fine)` && `(hover: hover)` — the *primary* pointer is a mouse. */
  finePrimary: boolean;
  /** `navigator.maxTouchPoints`. */
  maxTouch: number;
  /** Legacy `"ontouchstart" in window` fallback. */
  touchEvents: boolean;
  ua: string;
  platform: string;
}

/**
 * Pure classifier — given platform capabilities, decide form factor + primary
 * input. Kept dependency- and DOM-free so it is unit-testable for every
 * environment (iPhone, iPad/iPadOS-as-Mac, hybrid laptop, plain desktop).
 */
export function classifyDevice(c: DeviceCaps): DeviceInfo {
  const isTouch = c.coarse || c.noHover || c.maxTouch > 0 || c.touchEvents;
  const hasFinePointer = c.anyFine || c.finePrimary;

  const isIOS =
    /iPad|iPhone|iPod/.test(c.ua) ||
    // iPadOS 13+ masquerades as "MacIntel" but has a multi-touch screen.
    (c.platform === "MacIntel" && c.maxTouch > 1);

  // Mouse + hover always wins (covers touch-screen laptops); otherwise a touch
  // screen drives the on-screen controls.
  const primaryInput: PrimaryInput = c.finePrimary ? "mouse" : isTouch ? "touch" : "mouse";
  const touchUI = primaryInput === "touch";

  const deviceClass: DeviceClass =
    primaryInput === "mouse"
      ? "desktop"
      : Math.min(c.width, c.height) >= TABLET_MIN_EDGE
        ? "tablet"
        : "phone";

  return {
    deviceClass,
    primaryInput,
    touchUI,
    isTouch,
    isIOS,
    hasFinePointer,
    width: c.width,
    height: c.height,
  };
}

function detect(): DeviceInfo {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      deviceClass: "desktop",
      primaryInput: "mouse",
      touchUI: false,
      isTouch: false,
      isIOS: false,
      hasFinePointer: true,
      width: 1024,
      height: 768,
    };
  }

  const mm = (q: string) => window.matchMedia(q).matches;
  return classifyDevice({
    width: window.innerWidth,
    height: window.innerHeight,
    coarse: mm("(pointer: coarse)"),
    noHover: mm("(hover: none)"),
    anyFine: mm("(any-pointer: fine)"),
    finePrimary: mm("(pointer: fine)") && mm("(hover: hover)"),
    maxTouch: navigator.maxTouchPoints || 0,
    touchEvents: "ontouchstart" in window,
    ua: navigator.userAgent || "",
    platform: navigator.platform || "",
  });
}

let current = detect();
const listeners = new Set<() => void>();
let bound = false;

function applyRootAttrs(d: DeviceInfo) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.dataset.device = d.deviceClass;
  el.dataset.input = d.primaryInput;
  el.classList.toggle("is-ios", d.isIOS);
  el.classList.toggle("is-touch", d.touchUI);
}

function recompute() {
  const next = detect();
  if (
    next.deviceClass !== current.deviceClass ||
    next.primaryInput !== current.primaryInput ||
    next.isIOS !== current.isIOS ||
    next.isTouch !== current.isTouch ||
    next.hasFinePointer !== current.hasFinePointer ||
    next.width !== current.width ||
    next.height !== current.height
  ) {
    current = next;
    applyRootAttrs(current);
    listeners.forEach((l) => l());
  }
}

function bind() {
  if (bound || typeof window === "undefined") return;
  bound = true;
  window.addEventListener("resize", recompute);
  window.addEventListener("orientationchange", recompute);
  for (const q of ["(pointer: coarse)", "(hover: none)", "(pointer: fine)", "(any-pointer: fine)"]) {
    const mql = window.matchMedia(q);
    // Safari < 14 only supports the deprecated addListener API.
    if (mql.addEventListener) mql.addEventListener("change", recompute);
    else mql.addListener(recompute);
  }
  applyRootAttrs(current);
}

function subscribe(cb: () => void): () => void {
  bind();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): DeviceInfo {
  return current;
}

const serverSnapshot = detect();
function getServerSnapshot(): DeviceInfo {
  return serverSnapshot;
}

/** Live device/input snapshot shared across the app. */
export function useDevice(): DeviceInfo {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Convenience: true when the UI should present on-screen touch controls. */
export function useTouchUI(): boolean {
  return useDevice().touchUI;
}
