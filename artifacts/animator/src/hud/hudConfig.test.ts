import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clampAppearance,
  clampCustomLook,
  clampPanel,
  defaultAppearance,
  defaultHudConfig,
  hasAppearanceOverrides,
  HUD_PANEL_IDS,
  HUD_PANEL_META,
  loadCustomLooks,
  loadHudConfig,
  lookMatchesConfig,
  makeCustomLook,
  MAX_GLOW,
  MAX_LOOK_NAME,
  MAX_LOOKS,
  MAX_OFFSET,
  MAX_RADIUS,
  MAX_SCALE,
  MIN_SCALE,
  mergeConfig,
  mergeCustomLooks,
  resolveHudVars,
  saveCustomLooks,
  saveHudConfig,
  type HudCustomLook,
} from "./hudConfig";
import { hudThemeVars, HUD_FONTS } from "./hudThemes";
import {
  clampQuickSlots,
  defaultQuickSlots,
  isQuickActionId,
  QUICK_ACTION_IDS,
  QUICK_ACTIONS,
  QUICK_SLOT_COUNT,
  QUICK_SLOTS_PER_SIDE,
} from "./quickActions";

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

describe("clampPanel", () => {
  it("fills defaults for missing fields", () => {
    expect(clampPanel(undefined)).toEqual({ dx: 0, dy: 0, scale: 1, hidden: false });
    expect(clampPanel({})).toEqual({ dx: 0, dy: 0, scale: 1, hidden: false });
  });

  it("clamps offsets and scale into bounds", () => {
    expect(clampPanel({ dx: 99999, dy: -99999 }).dx).toBe(MAX_OFFSET);
    expect(clampPanel({ dx: 99999, dy: -99999 }).dy).toBe(-MAX_OFFSET);
    expect(clampPanel({ scale: 99 }).scale).toBe(MAX_SCALE);
    expect(clampPanel({ scale: 0 }).scale).toBe(MIN_SCALE);
  });

  it("rejects non-finite / non-numeric values", () => {
    expect(clampPanel({ dx: NaN, scale: Infinity })).toEqual({
      dx: 0,
      dy: 0,
      scale: 1,
      hidden: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampPanel({ dx: "10" as any }).dx).toBe(0);
  });

  it("coerces hidden to a strict boolean", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampPanel({ hidden: 1 as any }).hidden).toBe(false);
    expect(clampPanel({ hidden: true }).hidden).toBe(true);
  });
});

describe("mergeConfig", () => {
  it("returns full defaults for junk input", () => {
    const def = defaultHudConfig();
    expect(mergeConfig(null)).toEqual(def);
    expect(mergeConfig("nope")).toEqual(def);
    expect(mergeConfig(42)).toEqual(def);
  });

  it("keeps a known theme and falls back on an unknown one", () => {
    expect(mergeConfig({ theme: "cyberpunk" }).theme).toBe("cyberpunk");
    expect(mergeConfig({ theme: "bogus" }).theme).toBe("default");
  });

  it("always materialises every panel id", () => {
    const merged = mergeConfig({ panels: { vitals: { dx: 50 } } });
    for (const id of HUD_PANEL_IDS) expect(merged.panels[id]).toBeDefined();
    expect(merged.panels.vitals.dx).toBe(50);
    expect(merged.panels.stats).toEqual({ dx: 0, dy: 0, scale: 1, hidden: false });
  });

  it("drops unknown panel ids", () => {
    const merged = mergeConfig({ panels: { bogus: { dx: 9 } } });
    expect((merged.panels as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("clamps hostile persisted values", () => {
    const merged = mergeConfig({ panels: { vitals: { dx: 1e9, scale: 1e9 } } });
    expect(merged.panels.vitals.dx).toBe(MAX_OFFSET);
    expect(merged.panels.vitals.scale).toBe(MAX_SCALE);
  });
});

describe("mech cockpit panel", () => {
  it("is a registered HUD panel with metadata", () => {
    expect(HUD_PANEL_IDS).toContain("mech");
    expect(HUD_PANEL_META.mech).toBeDefined();
    expect(HUD_PANEL_META.mech.label).toBeTruthy();
    expect(HUD_PANEL_META.mech.hint).toBeTruthy();
  });

  it("appears at defaults in a fresh config", () => {
    expect(defaultHudConfig().panels.mech).toEqual({ dx: 0, dy: 0, scale: 1, hidden: false });
  });

  it("clamps a hostile persisted mech layout", () => {
    const merged = mergeConfig({ panels: { mech: { dx: 1e9, dy: -1e9, scale: 1e9, hidden: true } } });
    expect(merged.panels.mech).toEqual({
      dx: MAX_OFFSET,
      dy: -MAX_OFFSET,
      scale: MAX_SCALE,
      hidden: true,
    });
  });

  it("materialises mech at defaults when a legacy blob omits it", () => {
    const merged = mergeConfig({ panels: { vitals: { dx: 10 } } });
    expect(merged.panels.mech).toEqual({ dx: 0, dy: 0, scale: 1, hidden: false });
  });

  it("round-trips a customised mech layout through save + load", () => {
    const config = defaultHudConfig();
    config.panels.mech = clampPanel({ dx: 42, dy: -17, scale: 1.5, hidden: true });
    saveHudConfig(config);
    expect(loadHudConfig().panels.mech).toEqual({ dx: 42, dy: -17, scale: 1.5, hidden: true });
  });
});

describe("HUD_tight layout + quick slots", () => {
  it("defaults to the classic layout with a fully populated 6+6 loadout", () => {
    const def = defaultHudConfig();
    expect(def.layout).toBe("classic");
    expect(def.quickSlots).toHaveLength(QUICK_SLOT_COUNT);
    expect(QUICK_SLOT_COUNT).toBe(QUICK_SLOTS_PER_SIDE * 2);
    for (const slot of def.quickSlots) expect(isQuickActionId(slot)).toBe(true);
  });

  it("every quick action id resolves to catalog metadata", () => {
    expect(QUICK_ACTION_IDS).toHaveLength(QUICK_SLOT_COUNT);
    for (const id of QUICK_ACTION_IDS) {
      const def = QUICK_ACTIONS[id];
      expect(def.id).toBe(id);
      expect(def.label).toBeTruthy();
      expect(def.icon).toBeTruthy();
      expect(def.key).toBeTruthy();
      expect(["action", "skill", "item"]).toContain(def.kind);
    }
  });

  it("registers the tight-bar panel for the editor", () => {
    expect(HUD_PANEL_IDS).toContain("tightbar");
    expect(HUD_PANEL_META.tightbar.label).toBeTruthy();
  });

  it("drops the retired quick-menu panel ids from persisted configs", () => {
    const merged = mergeConfig({
      panels: { quickLeft: { dx: 50 }, tightbar: { dx: 25 } },
    });
    expect((merged.panels as Record<string, unknown>).quickLeft).toBeUndefined();
    expect(merged.panels.tightbar.dx).toBe(25);
  });

  it("keeps a known layout and falls back on an unknown one", () => {
    expect(mergeConfig({ layout: "tight" }).layout).toBe("tight");
    expect(mergeConfig({ layout: "bogus" }).layout).toBe("classic");
    expect(mergeConfig({}).layout).toBe("classic");
  });

  it("clamps hostile persisted quick slots to nulls, sized exactly 12", () => {
    const merged = mergeConfig({
      quickSlots: ["primary", "bogus", 42, null, "heal"],
    });
    expect(merged.quickSlots).toHaveLength(QUICK_SLOT_COUNT);
    expect(merged.quickSlots[0]).toBe("primary");
    expect(merged.quickSlots[1]).toBeNull();
    expect(merged.quickSlots[2]).toBeNull();
    expect(merged.quickSlots[3]).toBeNull();
    expect(merged.quickSlots[4]).toBe("heal");
    for (let i = 5; i < QUICK_SLOT_COUNT; i++) expect(merged.quickSlots[i]).toBeNull();
  });

  it("truncates an over-long persisted slot list", () => {
    const raw = Array.from({ length: QUICK_SLOT_COUNT + 8 }, () => "block");
    expect(clampQuickSlots(raw)).toHaveLength(QUICK_SLOT_COUNT);
  });

  it("falls back to the default loadout when quickSlots is not an array", () => {
    expect(clampQuickSlots(undefined)).toEqual(defaultQuickSlots());
    expect(clampQuickSlots("nope")).toEqual(defaultQuickSlots());
    expect(mergeConfig({ layout: "tight" }).quickSlots).toEqual(defaultQuickSlots());
  });

  it("materialises layout + slots for legacy blobs that predate them", () => {
    const merged = mergeConfig({ theme: "rpg", panels: { vitals: { dx: 5 } } });
    expect(merged.layout).toBe("classic");
    expect(merged.quickSlots).toEqual(defaultQuickSlots());
  });

  it("round-trips a tight-layout config through save + load", () => {
    const config = defaultHudConfig();
    config.layout = "tight";
    config.quickSlots = [...defaultQuickSlots()];
    config.quickSlots[2] = null;
    config.quickSlots[11] = "bomb";
    saveHudConfig(config);
    const loaded = loadHudConfig();
    expect(loaded.layout).toBe("tight");
    expect(loaded.quickSlots).toEqual(config.quickSlots);
  });
});

describe("save + load persistence", () => {
  it("falls back to defaults when nothing is stored", () => {
    expect(loadHudConfig()).toEqual(defaultHudConfig());
  });

  it("round-trips a full config through localStorage", () => {
    const config = defaultHudConfig();
    config.theme = "cyberpunk";
    config.panels.vitals = clampPanel({ dx: 100, dy: 50, scale: 1.25, hidden: false });
    config.panels.mech = clampPanel({ dx: -30, dy: 12, scale: 0.75, hidden: true });
    saveHudConfig(config);
    expect(loadHudConfig()).toEqual(config);
  });

  it("falls back to defaults on a corrupt stored blob", () => {
    localStorage.setItem("animator.hud.editor.v1", "{ not valid json");
    expect(loadHudConfig()).toEqual(defaultHudConfig());
  });
});

describe("clampAppearance", () => {
  it("defaults every field to null (a no-op overlay)", () => {
    expect(clampAppearance(undefined)).toEqual(defaultAppearance());
    expect(clampAppearance({})).toEqual({
      accent: null,
      accent2: null,
      radius: null,
      glow: null,
      font: null,
    });
  });

  it("accepts only safe hex colors", () => {
    expect(clampAppearance({ accent: "#ff0066" }).accent).toBe("#ff0066");
    expect(clampAppearance({ accent: "#abc" }).accent).toBe("#abc");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampAppearance({ accent: "red; }" as any }).accent).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampAppearance({ accent: "url(evil)" as any }).accent).toBeNull();
  });

  it("clamps radius and glow into bounds, rejecting non-numbers", () => {
    expect(clampAppearance({ radius: 999 }).radius).toBe(MAX_RADIUS);
    expect(clampAppearance({ radius: -5 }).radius).toBe(0);
    expect(clampAppearance({ glow: 99 }).glow).toBe(MAX_GLOW);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampAppearance({ glow: "2" as any }).glow).toBeNull();
    expect(clampAppearance({ radius: NaN }).radius).toBeNull();
  });

  it("guards the font id", () => {
    expect(clampAppearance({ font: "mono" }).font).toBe("mono");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampAppearance({ font: "comic" as any }).font).toBeNull();
  });
});

describe("hasAppearanceOverrides", () => {
  it("is false for a fresh appearance and true once any field is set", () => {
    expect(hasAppearanceOverrides(defaultAppearance())).toBe(false);
    expect(hasAppearanceOverrides({ ...defaultAppearance(), accent: "#fff" })).toBe(true);
    expect(hasAppearanceOverrides({ ...defaultAppearance(), radius: 0 })).toBe(true);
  });
});

describe("resolveHudVars", () => {
  it("returns the bare theme preset (plus glow=1) when no overrides", () => {
    const cfg = defaultHudConfig();
    cfg.theme = "cyberpunk";
    const vars = resolveHudVars(cfg);
    const preset = hudThemeVars("cyberpunk");
    expect(vars["--hud-accent"]).toBe(preset["--hud-accent"]);
    expect(vars["--hud-radius"]).toBe(preset["--hud-radius"]);
    expect(vars["--hud-glow-strength"]).toBe("1");
  });

  it("layers overrides on top of the active theme", () => {
    const cfg = defaultHudConfig();
    cfg.theme = "rpg";
    cfg.appearance = {
      accent: "#ff0066",
      accent2: null,
      radius: 4,
      glow: 1.5,
      font: "mono",
    };
    const vars = resolveHudVars(cfg);
    expect(vars["--hud-accent"]).toBe("#ff0066");
    expect(vars["--hud-accent-2"]).toBe(hudThemeVars("rpg")["--hud-accent-2"]);
    expect(vars["--hud-radius"]).toBe("4px");
    expect(vars["--hud-glow-strength"]).toBe("1.5");
    expect(vars["--hud-font"]).toBe(HUD_FONTS.mono.stack);
  });
});

describe("appearance persistence + merge", () => {
  it("materialises appearance at defaults for legacy blobs without it", () => {
    expect(mergeConfig({ theme: "rpg" }).appearance).toEqual(defaultAppearance());
  });

  it("clamps hostile persisted appearance", () => {
    const merged = mergeConfig({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appearance: { accent: "javascript:alert(1)", radius: 1e9, glow: 1e9, font: "x" } as any,
    });
    expect(merged.appearance.accent).toBeNull();
    expect(merged.appearance.radius).toBe(MAX_RADIUS);
    expect(merged.appearance.glow).toBe(MAX_GLOW);
    expect(merged.appearance.font).toBeNull();
  });

  it("round-trips a customised appearance through save + load", () => {
    const config = defaultHudConfig();
    config.theme = "ember";
    config.appearance = {
      accent: "#12ab34",
      accent2: "#abc",
      radius: 8,
      glow: 1.25,
      font: "display",
    };
    saveHudConfig(config);
    expect(loadHudConfig()).toEqual(config);
  });
});

describe("makeCustomLook", () => {
  it("snapshots the config's theme + appearance with a trimmed name and an id", () => {
    const config = defaultHudConfig();
    config.theme = "abyss";
    config.appearance = { ...defaultAppearance(), accent: "#2ee6c0", glow: 1.5 };
    const look = makeCustomLook("  Deep Teal  ", config);
    expect(look.name).toBe("Deep Teal");
    expect(look.theme).toBe("abyss");
    expect(look.appearance).toEqual(config.appearance);
    expect(look.id).toBeTruthy();
  });

  it("copies the appearance so later config edits don't mutate the look", () => {
    const config = defaultHudConfig();
    const look = makeCustomLook("Snap", config);
    config.appearance.accent = "#ffffff";
    expect(look.appearance.accent).toBeNull();
  });

  it("caps the name length", () => {
    const long = "x".repeat(MAX_LOOK_NAME + 20);
    expect(makeCustomLook(long, defaultHudConfig()).name.length).toBe(MAX_LOOK_NAME);
  });
});

describe("clampCustomLook", () => {
  it("rejects non-objects and nameless looks", () => {
    expect(clampCustomLook(null)).toBeNull();
    expect(clampCustomLook("nope")).toBeNull();
    expect(clampCustomLook({ theme: "rpg" })).toBeNull();
    expect(clampCustomLook({ name: "   " })).toBeNull();
  });

  it("falls back unknown theme to default and clamps a hostile appearance", () => {
    const look = clampCustomLook({
      id: "abc",
      name: "Hacky",
      theme: "bogus",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appearance: { accent: "javascript:alert(1)", radius: 1e9 } as any,
    });
    expect(look).not.toBeNull();
    expect(look!.theme).toBe("default");
    expect(look!.appearance.accent).toBeNull();
    expect(look!.appearance.radius).toBe(MAX_RADIUS);
  });

  it("synthesises an id when one is missing", () => {
    const look = clampCustomLook({ name: "No Id" });
    expect(look!.id).toBeTruthy();
  });
});

describe("mergeCustomLooks", () => {
  it("returns an empty list for non-arrays", () => {
    expect(mergeCustomLooks(null)).toEqual([]);
    expect(mergeCustomLooks({})).toEqual([]);
    expect(mergeCustomLooks("looks")).toEqual([]);
  });

  it("drops invalid entries but keeps valid ones", () => {
    const merged = mergeCustomLooks([
      { name: "Good", theme: "rpg" },
      null,
      { theme: "ember" }, // no name
      "junk",
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Good");
  });

  it("dedupes repeated ids", () => {
    const merged = mergeCustomLooks([
      { id: "dup", name: "A" },
      { id: "dup", name: "B" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).not.toBe(merged[1].id);
  });

  it("caps the list at MAX_LOOKS", () => {
    const raw = Array.from({ length: MAX_LOOKS + 10 }, (_, i) => ({
      id: `id-${i}`,
      name: `Look ${i}`,
    }));
    expect(mergeCustomLooks(raw)).toHaveLength(MAX_LOOKS);
  });
});

describe("saved looks persistence", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(loadCustomLooks()).toEqual([]);
  });

  it("round-trips a list of looks through localStorage", () => {
    const looks: HudCustomLook[] = [
      makeCustomLook("First", { ...defaultHudConfig(), theme: "cyberpunk" }),
      makeCustomLook("Second", {
        ...defaultHudConfig(),
        theme: "fantasy",
        appearance: { ...defaultAppearance(), accent: "#b8862f", radius: 12 },
      }),
    ];
    saveCustomLooks(looks);
    expect(loadCustomLooks()).toEqual(looks);
  });

  it("falls back to an empty list on a corrupt stored blob", () => {
    localStorage.setItem("animator.hud.looks.v1", "{ not valid json");
    expect(loadCustomLooks()).toEqual([]);
  });

  it("sanitises a hostile stored blob on load", () => {
    localStorage.setItem(
      "animator.hud.looks.v1",
      JSON.stringify([{ name: "Evil", theme: "x", appearance: { accent: "url(bad)" } }, 42]),
    );
    const loaded = loadCustomLooks();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].theme).toBe("default");
    expect(loaded[0].appearance.accent).toBeNull();
  });
});

describe("lookMatchesConfig", () => {
  it("is true only when theme and every appearance field match", () => {
    const config = defaultHudConfig();
    config.theme = "ember";
    config.appearance = { ...defaultAppearance(), accent: "#ff6b2c", glow: 1.2 };
    const match = makeCustomLook("Match", config);
    expect(lookMatchesConfig(match, config)).toBe(true);

    const otherTheme = makeCustomLook("Other", { ...config, theme: "rpg" });
    expect(lookMatchesConfig(otherTheme, config)).toBe(false);

    const otherAppearance = makeCustomLook("Diff", {
      ...config,
      appearance: { ...config.appearance, accent: "#000000" },
    });
    expect(lookMatchesConfig(otherAppearance, config)).toBe(false);
  });
});
