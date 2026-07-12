import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EDITOR } from "./types";
import { loadControls, loadMouseFeel, saveControls, subscribeMouseFeel } from "./controlsSettings";

const KEY = "dangerroom:controls";
const SCHEMA = 1;

// The vitest env is `node` (no DOM), so install a minimal in-memory localStorage
// for the save/load round-trip tests and reset it between cases.
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

describe("loadControls", () => {
  it("returns the defaults when nothing is persisted", () => {
    expect(loadControls()).toEqual(DEFAULT_EDITOR);
  });

  it("returns a fresh copy of the defaults (not the shared object)", () => {
    expect(loadControls()).not.toBe(DEFAULT_EDITOR);
  });

  it("ignores a blob written without the current schema tag", () => {
    localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_EDITOR, mouseSensitivity: 2 }));
    // No `schema` field → treated as foreign/stale → defaults.
    expect(loadControls()).toEqual(DEFAULT_EDITOR);
  });

  it("clamps out-of-range numeric fields into their slider bounds", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ schema: SCHEMA, mouseSensitivity: 99, cameraDistance: -5, fov: 1 }),
    );
    const loaded = loadControls();
    expect(loaded.mouseSensitivity).toBe(3); // max
    expect(loaded.cameraDistance).toBe(2.5); // min
    expect(loaded.fov).toBe(40); // min
  });

  it("falls back to the field default for non-finite numbers", () => {
    localStorage.setItem(KEY, JSON.stringify({ schema: SCHEMA, gravity: "heavy", moveSpeed: null }));
    const loaded = loadControls();
    expect(loaded.gravity).toBe(DEFAULT_EDITOR.gravity);
    expect(loaded.moveSpeed).toBe(DEFAULT_EDITOR.moveSpeed);
  });

  it("coerces invertY / showSkeleton to booleans", () => {
    localStorage.setItem(KEY, JSON.stringify({ schema: SCHEMA, invertY: "yes", showSkeleton: 1 }));
    const loaded = loadControls();
    expect(loaded.invertY).toBe(DEFAULT_EDITOR.invertY);
    expect(loaded.showSkeleton).toBe(DEFAULT_EDITOR.showSkeleton);
  });

  it("never persists modelYaw — it resets to the default per load", () => {
    saveControls({ ...DEFAULT_EDITOR, modelYaw: 1.23 });
    expect(loadControls().modelYaw).toBe(DEFAULT_EDITOR.modelYaw);
  });

  it("falls back to defaults when the stored JSON is corrupt", () => {
    localStorage.setItem(KEY, "{not valid json");
    expect(loadControls()).toEqual(DEFAULT_EDITOR);
  });
});

describe("saveControls / loadControls round-trip", () => {
  it("round-trips a customized in-range settings object (modelYaw excepted)", () => {
    const custom = {
      ...DEFAULT_EDITOR,
      mouseSensitivity: 1.8,
      invertY: true,
      cameraDistance: 7,
      fov: 80,
      moveSpeed: 6,
    };
    saveControls(custom);
    expect(loadControls()).toEqual({ ...custom, modelYaw: DEFAULT_EDITOR.modelYaw });
  });
});

describe("loadMouseFeel", () => {
  it("returns the persisted sensitivity + invertY for shared (e.g. voxel) use", () => {
    saveControls({ ...DEFAULT_EDITOR, mouseSensitivity: 2.4, invertY: true });
    expect(loadMouseFeel()).toEqual({ sensitivity: 2.4, invertY: true });
  });

  it("returns the defaults when nothing is persisted", () => {
    expect(loadMouseFeel()).toEqual({
      sensitivity: DEFAULT_EDITOR.mouseSensitivity,
      invertY: DEFAULT_EDITOR.invertY,
    });
  });
});

describe("subscribeMouseFeel", () => {
  it("notifies listeners with the new feel whenever controls are saved", () => {
    const seen: { sensitivity: number; invertY: boolean }[] = [];
    const off = subscribeMouseFeel((feel) => seen.push(feel));
    saveControls({ ...DEFAULT_EDITOR, mouseSensitivity: 2.1, invertY: true });
    off();
    expect(seen).toEqual([{ sensitivity: 2.1, invertY: true }]);
  });

  it("stops notifying after unsubscribe", () => {
    let calls = 0;
    const off = subscribeMouseFeel(() => calls++);
    saveControls({ ...DEFAULT_EDITOR, mouseSensitivity: 1.5 });
    off();
    saveControls({ ...DEFAULT_EDITOR, mouseSensitivity: 2.9 });
    expect(calls).toBe(1);
  });

  it("isolates a throwing listener from the others", () => {
    let reached = false;
    const offBad = subscribeMouseFeel(() => {
      throw new Error("boom");
    });
    const offGood = subscribeMouseFeel(() => {
      reached = true;
    });
    saveControls({ ...DEFAULT_EDITOR, mouseSensitivity: 1.2 });
    offBad();
    offGood();
    expect(reached).toBe(true);
  });
});
