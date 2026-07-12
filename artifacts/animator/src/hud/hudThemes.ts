// HUD theme presets for the Danger Room 2D UI-layer editor.
//
// Each preset is a flat map of CSS custom properties applied to the `.studio`
// root; the HUD CSS consumes them so a single theme swap restyles every panel at
// once (in the spirit of the Grudge Studio Game UI Kit's theme presets). This is
// pure data — no DOM, no imports — so it is trivially unit-testable.

/** Every CSS variable a HUD theme must define (kept exhaustive on purpose). */
export const HUD_THEME_VARS = [
  "--hud-font",
  "--hud-text",
  "--hud-muted",
  "--hud-accent",
  "--hud-accent-2",
  "--hud-panel-bg",
  "--hud-panel-border",
  "--hud-radius",
  "--hud-glow",
  "--hud-hp",
  "--hud-sp",
] as const;

export type HudThemeVar = (typeof HUD_THEME_VARS)[number];
export type HudThemeVars = Record<HudThemeVar, string>;

export type HudThemeId =
  | "default"
  | "cyberpunk"
  | "rpg"
  | "fantasy"
  | "tactical"
  | "ember"
  | "abyss";

export interface HudTheme {
  id: HudThemeId;
  name: string;
  /** Short flavour line shown in the editor (mirrors the Grudge kit copy). */
  blurb: string;
  vars: HudThemeVars;
}

// The shipped sci-fi look — keeps the Danger Room identical when no theme picked.
const DEFAULT_VARS: HudThemeVars = {
  "--hud-font": "'Inter', system-ui, sans-serif",
  "--hud-text": "#dbe7ff",
  "--hud-muted": "#8fb0d8",
  "--hud-accent": "#4fc3ff",
  "--hud-accent-2": "#b9aaff",
  "--hud-panel-bg": "linear-gradient(160deg, rgba(12,22,38,0.92), rgba(8,14,24,0.86))",
  "--hud-panel-border": "rgba(79,195,255,0.35)",
  "--hud-radius": "14px",
  "--hud-glow": "rgba(62,233,255,0.45)",
  "--hud-hp": "linear-gradient(90deg, #ff2d55, #ff7a3c)",
  "--hud-sp": "linear-gradient(90deg, #12b9e6, #6fe0ff)",
};

export const HUD_THEMES: Record<HudThemeId, HudTheme> = {
  default: {
    id: "default",
    name: "Danger Room",
    blurb: "The stock sci-fi blue HUD.",
    vars: DEFAULT_VARS,
  },
  cyberpunk: {
    id: "cyberpunk",
    name: "Cyberpunk",
    blurb: "Neon pixel HUDs, glitch panels and chrome.",
    vars: {
      "--hud-font": "'JetBrains Mono', ui-monospace, monospace",
      "--hud-text": "#f6f9ff",
      "--hud-muted": "#7fe9ff",
      "--hud-accent": "#ff2bd6",
      "--hud-accent-2": "#23f0ff",
      "--hud-panel-bg": "linear-gradient(160deg, rgba(22,4,30,0.92), rgba(6,2,14,0.9))",
      "--hud-panel-border": "rgba(255,43,214,0.55)",
      "--hud-radius": "2px",
      "--hud-glow": "rgba(255,43,214,0.55)",
      "--hud-hp": "linear-gradient(90deg, #ff2bd6, #ff6a3c)",
      "--hud-sp": "linear-gradient(90deg, #23f0ff, #7a5cff)",
    },
  },
  rpg: {
    id: "rpg",
    name: "RPG",
    blurb: "Ornate high-fantasy frames, scrolls and runes.",
    vars: {
      "--hud-font": "Georgia, 'Times New Roman', serif",
      "--hud-text": "#f3e7c8",
      "--hud-muted": "#c8ab73",
      "--hud-accent": "#e8b94a",
      "--hud-accent-2": "#9bd1ff",
      "--hud-panel-bg": "linear-gradient(160deg, rgba(40,28,14,0.94), rgba(24,16,8,0.9))",
      "--hud-panel-border": "rgba(232,185,74,0.55)",
      "--hud-radius": "10px",
      "--hud-glow": "rgba(232,185,74,0.45)",
      "--hud-hp": "linear-gradient(90deg, #c0392b, #e8654b)",
      "--hud-sp": "linear-gradient(90deg, #2e7d8c, #57c7e0)",
    },
  },
  fantasy: {
    id: "fantasy",
    name: "Fantasy",
    blurb: "Warm parchment, gilded edges and candlelight.",
    vars: {
      "--hud-font": "Georgia, 'Palatino Linotype', serif",
      "--hud-text": "#3a2a16",
      "--hud-muted": "#7a5c34",
      "--hud-accent": "#b8862f",
      "--hud-accent-2": "#7a4d9c",
      "--hud-panel-bg": "linear-gradient(160deg, rgba(240,224,184,0.95), rgba(214,191,142,0.92))",
      "--hud-panel-border": "rgba(120,82,30,0.6)",
      "--hud-radius": "12px",
      "--hud-glow": "rgba(184,134,47,0.4)",
      "--hud-hp": "linear-gradient(90deg, #a8321f, #d2654a)",
      "--hud-sp": "linear-gradient(90deg, #2f6f86, #57b0c7)",
    },
  },
  tactical: {
    id: "tactical",
    name: "FPS / Tactical",
    blurb: "High-contrast tactical HUD, crisp and fast.",
    vars: {
      "--hud-font": "'JetBrains Mono', ui-monospace, monospace",
      "--hud-text": "#d8ffe0",
      "--hud-muted": "#7fae8c",
      "--hud-accent": "#57e08a",
      "--hud-accent-2": "#f0c64b",
      "--hud-panel-bg": "linear-gradient(160deg, rgba(10,16,12,0.94), rgba(6,10,8,0.92))",
      "--hud-panel-border": "rgba(87,224,138,0.5)",
      "--hud-radius": "3px",
      "--hud-glow": "rgba(87,224,138,0.4)",
      "--hud-hp": "linear-gradient(90deg, #d83a3a, #ff7a3c)",
      "--hud-sp": "linear-gradient(90deg, #2f9b6b, #57e08a)",
    },
  },
  ember: {
    id: "ember",
    name: "Ember Forge",
    blurb: "Volcanic charcoal plate, molten orange edges.",
    vars: {
      "--hud-font": "'Oswald', 'Inter', system-ui, sans-serif",
      "--hud-text": "#ffe7d4",
      "--hud-muted": "#d39a78",
      "--hud-accent": "#ff6b2c",
      "--hud-accent-2": "#ffd24a",
      "--hud-panel-bg": "linear-gradient(160deg, rgba(30,12,8,0.94), rgba(16,8,6,0.9))",
      "--hud-panel-border": "rgba(255,107,44,0.5)",
      "--hud-radius": "6px",
      "--hud-glow": "rgba(255,107,44,0.5)",
      "--hud-hp": "linear-gradient(90deg, #ff3b2f, #ff7a3c)",
      "--hud-sp": "linear-gradient(90deg, #c97a16, #ffd24a)",
    },
  },
  abyss: {
    id: "abyss",
    name: "Abyssal",
    blurb: "Bioluminescent deep-sea teal on void black.",
    vars: {
      "--hud-font": "'Rajdhani', 'Inter', system-ui, sans-serif",
      "--hud-text": "#dffaf2",
      "--hud-muted": "#79b8ac",
      "--hud-accent": "#2ee6c0",
      "--hud-accent-2": "#b46bff",
      "--hud-panel-bg": "linear-gradient(160deg, rgba(4,20,22,0.94), rgba(2,10,16,0.9))",
      "--hud-panel-border": "rgba(46,230,192,0.45)",
      "--hud-radius": "18px",
      "--hud-glow": "rgba(46,230,192,0.5)",
      "--hud-hp": "linear-gradient(90deg, #ff4d7a, #ff9a5c)",
      "--hud-sp": "linear-gradient(90deg, #1f9e9e, #2ee6c0)",
    },
  },
};

export const HUD_THEME_IDS = Object.keys(HUD_THEMES) as HudThemeId[];

export function isHudThemeId(v: unknown): v is HudThemeId {
  return typeof v === "string" && v in HUD_THEMES;
}

/** Resolve a theme by id, falling back to the default look for unknown ids. */
export function hudThemeVars(id: HudThemeId): HudThemeVars {
  return (HUD_THEMES[id] ?? HUD_THEMES.default).vars;
}

/* ------------------------------------------------------------------ *
 * Font presets for the customization panel's "Typeface" override.
 * Selecting one overrides `--hud-font` on top of the active theme.
 * ------------------------------------------------------------------ */

export type HudFontId = "sans" | "mono" | "serif" | "display" | "condensed";

export interface HudFont {
  id: HudFontId;
  name: string;
  stack: string;
}

export const HUD_FONTS: Record<HudFontId, HudFont> = {
  sans: { id: "sans", name: "Sans", stack: "'Inter', system-ui, sans-serif" },
  mono: { id: "mono", name: "Mono", stack: "'JetBrains Mono', ui-monospace, monospace" },
  serif: { id: "serif", name: "Serif", stack: "Georgia, 'Times New Roman', serif" },
  display: { id: "display", name: "Display", stack: "'Trebuchet MS', 'Segoe UI', sans-serif" },
  condensed: { id: "condensed", name: "Condensed", stack: "'Oswald', 'Arial Narrow', sans-serif" },
};

export const HUD_FONT_IDS = Object.keys(HUD_FONTS) as HudFontId[];

export function isHudFontId(v: unknown): v is HudFontId {
  return typeof v === "string" && v in HUD_FONTS;
}
