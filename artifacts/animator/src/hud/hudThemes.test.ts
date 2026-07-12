import { describe, expect, it } from "vitest";
import {
  HUD_THEMES,
  HUD_THEME_IDS,
  HUD_THEME_VARS,
  hudThemeVars,
  isHudThemeId,
} from "./hudThemes";

describe("hudThemes", () => {
  it("every theme defines every required CSS variable with a non-empty value", () => {
    for (const id of HUD_THEME_IDS) {
      const vars = HUD_THEMES[id].vars;
      for (const key of HUD_THEME_VARS) {
        expect(vars[key], `${id} missing ${key}`).toBeTruthy();
      }
    }
  });

  it("includes the default plus the six Grudge-kit presets", () => {
    expect(HUD_THEME_IDS).toEqual(
      expect.arrayContaining([
        "default",
        "cyberpunk",
        "rpg",
        "fantasy",
        "tactical",
        "ember",
        "abyss",
      ]),
    );
    expect(HUD_THEME_IDS).toHaveLength(7);
  });

  it("isHudThemeId guards unknown ids", () => {
    expect(isHudThemeId("cyberpunk")).toBe(true);
    expect(isHudThemeId("nope")).toBe(false);
    expect(isHudThemeId(undefined)).toBe(false);
    expect(isHudThemeId(42)).toBe(false);
  });

  it("hudThemeVars falls back to default for unknown ids", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hudThemeVars("bogus" as any)).toBe(HUD_THEMES.default.vars);
    expect(hudThemeVars("rpg")).toBe(HUD_THEMES.rpg.vars);
  });
});
