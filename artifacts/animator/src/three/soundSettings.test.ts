import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SOUND, loadSound, saveSound, type SoundSettings } from "./soundSettings";

const KEY = "dangerroom:sound";
const LEGACY_MUTE_KEY = "dangerroom:muted";

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

describe("loadSound", () => {
  it("returns the defaults when nothing is persisted", () => {
    expect(loadSound()).toEqual(DEFAULT_SOUND);
  });

  it("returns a fresh copy of the defaults (not the shared object)", () => {
    const loaded = loadSound();
    expect(loaded).not.toBe(DEFAULT_SOUND);
  });

  it("reads back a full persisted settings object", () => {
    const stored: SoundSettings = {
      muted: true,
      master: 0.5,
      combat: 0.25,
      ambient: 0.75,
      klaxon: 0.1,
      music: 0.6,
    };
    localStorage.setItem(KEY, JSON.stringify(stored));
    expect(loadSound()).toEqual(stored);
  });

  it("clamps out-of-range levels into 0..1", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ muted: false, master: 5, combat: -3, ambient: 2, klaxon: -0.5, music: 9 }),
    );
    expect(loadSound()).toEqual({
      muted: false,
      master: 1,
      combat: 0,
      ambient: 1,
      klaxon: 0,
      music: 1,
    });
  });

  it("falls back to defaults for non-numeric / non-finite levels", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ muted: "yes", master: "loud", combat: null, ambient: undefined }),
    );
    // muted is non-boolean → default false; bad numbers → per-field defaults (all 1).
    expect(loadSound()).toEqual(DEFAULT_SOUND);
  });

  it("ignores NaN levels and uses the field default", () => {
    // NaN doesn't survive JSON, so write the raw payload directly.
    localStorage.setItem(KEY, '{"muted":false,"master":NaN,"combat":0.3}');
    // Invalid JSON (NaN) → parse throws → defaults.
    expect(loadSound()).toEqual(DEFAULT_SOUND);
  });

  it("keeps valid fields and defaults only the missing ones", () => {
    localStorage.setItem(KEY, JSON.stringify({ combat: 0.4 }));
    expect(loadSound()).toEqual({ ...DEFAULT_SOUND, combat: 0.4 });
  });

  it("falls back to defaults when the stored JSON is corrupt", () => {
    localStorage.setItem(KEY, "{not valid json");
    expect(loadSound()).toEqual(DEFAULT_SOUND);
  });

  describe("legacy mute-key migration", () => {
    it("migrates a muted=1 legacy preference", () => {
      localStorage.setItem(LEGACY_MUTE_KEY, "1");
      expect(loadSound()).toEqual({ ...DEFAULT_SOUND, muted: true });
    });

    it("migrates a muted=0 legacy preference", () => {
      localStorage.setItem(LEGACY_MUTE_KEY, "0");
      expect(loadSound()).toEqual({ ...DEFAULT_SOUND, muted: false });
    });

    it("treats any non-'1' legacy value as unmuted", () => {
      localStorage.setItem(LEGACY_MUTE_KEY, "true");
      expect(loadSound()).toEqual({ ...DEFAULT_SOUND, muted: false });
    });

    it("prefers the new key over the legacy one when both exist", () => {
      localStorage.setItem(LEGACY_MUTE_KEY, "1");
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_SOUND, muted: false, master: 0.2 }));
      expect(loadSound()).toEqual({ ...DEFAULT_SOUND, muted: false, master: 0.2 });
    });
  });

  describe("pre-music blob upgrade", () => {
    it("defaults the music channel when an older blob predates it", () => {
      // A settings blob saved before the "music" channel existed: every other
      // channel is present, but `music` is absent entirely.
      const preMusic = { muted: false, master: 0.8, combat: 0.7, ambient: 0.6, klaxon: 0.5 };
      localStorage.setItem(KEY, JSON.stringify(preMusic));
      expect(loadSound()).toEqual({ ...preMusic, music: DEFAULT_SOUND.music });
    });

    it("keeps the other channels intact while filling in the missing music default", () => {
      const preMusic = { muted: true, master: 0.3, combat: 0.2, ambient: 0.1, klaxon: 0.05 };
      localStorage.setItem(KEY, JSON.stringify(preMusic));
      const loaded = loadSound();
      expect(loaded.music).toBe(DEFAULT_SOUND.music);
      expect(loaded.master).toBe(0.3);
      expect(loaded.muted).toBe(true);
    });
  });
});

describe("saveSound", () => {
  it("round-trips every channel through loadSound", () => {
    const settings: SoundSettings = {
      muted: true,
      master: 0.6,
      combat: 0.3,
      ambient: 0.9,
      klaxon: 0.45,
      music: 0.15,
    };
    saveSound(settings);
    expect(loadSound()).toEqual(settings);
  });

  it("persists the exact JSON shape under the mixer key", () => {
    const settings: SoundSettings = {
      muted: false,
      master: 1,
      combat: 0.5,
      ambient: 0.5,
      klaxon: 1,
      music: 0.5,
    };
    saveSound(settings);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(settings);
  });
});
