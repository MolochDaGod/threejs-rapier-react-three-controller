import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Controller } from "./Controller";
import { loadControls, saveControls } from "./controlsSettings";
import { DEFAULT_EDITOR, type Avatar, type EditorParams } from "./types";
import type { InputState } from "./input";

// Integration coverage for the wheel-zoom persistence flow the unit tests in
// `controlsSettings.test.ts` can't reach: the engine mutates `cameraDistance`
// straight onto the shared params object on wheel-zoom (outside React state),
// Studio persists it on teardown, and a fresh mount re-reads it via
// loadControls(). A regression anywhere along that chain would silently reset
// the player's zoom on every mode switch. Here we drive the REAL Controller
// wheel-zoom branch + the REAL save/load round-trip rather than asserting the
// numeric clamp in isolation.

// The vitest env is `node` (no DOM), so install a minimal in-memory localStorage
// for the save/load round-trip, reset between cases (mirrors controlsSettings.test.ts).
function installMemoryLocalStorage(): void {
  let store: Record<string, string> = {};
  const mock: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: mock,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => installMemoryLocalStorage());
afterEach(() => localStorage.clear());

// A no-op Avatar: the wheel-zoom + camera-orbit path only touches `root`
// (a real THREE.Group) and a handful of locomotion hooks, all safely stubbed.
function makeAvatar(): Avatar {
  const noop = () => {};
  return {
    root: new THREE.Group(),
    rightHand: null,
    leftHand: null,
    isOneShotActive: false,
    hasRole: () => false,
    playRole: noop,
    playRoleOnce: () => 0,
    playClipOnce: () => 0,
    setLocomotionRate: noop,
    setBlendTime: noop,
    setShowSkeleton: noop,
    setModelYaw: noop,
  } as unknown as Avatar;
}

// Feeds the Controller the same `{ dx, dy, wheel }` shape the real InputState
// would after a scroll, without needing the DOM the real InputState attaches to.
function makeInput(wheel: number): InputState {
  return {
    locked: false,
    lookActive: false,
    moveX: 0,
    moveY: 0,
    touchSprint: false,
    consumeMouse: () => ({ dx: 0, dy: 0, wheel }),
    down: () => false,
  } as unknown as InputState;
}

/**
 * Model one full "enter mode → wheel-zoom → leave mode" cycle the way the app
 * does it: a mode mount re-reads persisted controls (App/Studio call
 * loadControls() on every mount), the engine wheel-zooms the live params, and
 * teardown flushes the controls save (Studio.dispose). Returns the params the
 * session ran with so the caller can inspect the in-session value too.
 */
function runZoomSession(wheelDelta: number): EditorParams {
  const params = loadControls();
  const controller = new Controller(
    makeAvatar(),
    new THREE.PerspectiveCamera(),
    makeInput(wheelDelta),
    params,
  );
  // One engine frame: the real wheel-zoom branch mutates params.cameraDistance.
  controller.update(1 / 60);
  // Studio.dispose flushes the (debounced) controls save on teardown.
  saveControls(params);
  return params;
}

describe("camera zoom survives leaving and re-entering a mode", () => {
  it("persists a wheel-zoom-in so a re-mount reads the new distance", () => {
    expect(loadControls().cameraDistance).toBe(DEFAULT_EDITOR.cameraDistance);

    // Scroll in (negative deltaY pulls the orbit closer): 5.2 + (-200 * 0.005) = 4.2.
    const session = runZoomSession(-200);
    expect(session.cameraDistance).toBeCloseTo(4.2, 5);
    expect(session.cameraDistance).not.toBe(DEFAULT_EDITOR.cameraDistance);

    // "Re-enter the mode": a fresh mount re-reads storage and gets the zoom.
    expect(loadControls().cameraDistance).toBeCloseTo(4.2, 5);
  });

  it("persists a wheel-zoom-out the same way", () => {
    const session = runZoomSession(300); // 5.2 + (300 * 0.005) = 6.7
    expect(session.cameraDistance).toBeCloseTo(6.7, 5);
    expect(loadControls().cameraDistance).toBeCloseTo(6.7, 5);
  });

  it("re-mounting carries the persisted zoom into the next session's controller", () => {
    runZoomSession(-200); // persist 4.2

    // Re-enter: the new session starts from the persisted distance, and a fresh
    // wheel-zoom compounds on it rather than the default. 4.2 + (-200*0.005) = 3.2.
    const next = runZoomSession(-200);
    expect(next.cameraDistance).toBeCloseTo(3.2, 5);
    expect(loadControls().cameraDistance).toBeCloseTo(3.2, 5);
  });

  it("clamps an over-zoom to the slider range and persists the clamped value", () => {
    const tooClose = runZoomSession(-5000); // 5.2 - 25 → clamped to the 2.5 min
    expect(tooClose.cameraDistance).toBe(2.5);
    expect(loadControls().cameraDistance).toBe(2.5);

    localStorage.clear();

    const tooFar = runZoomSession(5000); // 5.2 + 25 → clamped to the 10 max
    expect(tooFar.cameraDistance).toBe(10);
    expect(loadControls().cameraDistance).toBe(10);
  });

  it("leaves the persisted zoom untouched when the wheel doesn't move", () => {
    const session = runZoomSession(0);
    expect(session.cameraDistance).toBe(DEFAULT_EDITOR.cameraDistance);
    expect(loadControls().cameraDistance).toBe(DEFAULT_EDITOR.cameraDistance);
  });
});
