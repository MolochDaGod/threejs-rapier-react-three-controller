// Persisted configuration for the Danger Room HUD editor: which theme is active
// and, per editable panel, its position offset / scale / visibility. Pure logic
// (clamp, merge, load, save) lives here so it can be unit-tested without a DOM.

import {
  HUD_FONTS,
  hudThemeVars,
  isHudFontId,
  isHudThemeId,
  type HudFontId,
  type HudThemeId,
} from "./hudThemes";
import { clampQuickSlots, defaultQuickSlots, type QuickSlots } from "./quickActions";

/** The HUD panels the editor can move / scale / hide. */
export type HudPanelId =
  | "vitals"
  | "actionbar"
  | "stats"
  | "enemy"
  | "status"
  | "reticle"
  | "mech"
  | "tightbar";

export const HUD_PANEL_IDS: HudPanelId[] = [
  "vitals",
  "actionbar",
  "stats",
  "enemy",
  "status",
  "reticle",
  "mech",
  "tightbar",
];

/** Human-facing metadata for the editor's layer list. */
export const HUD_PANEL_META: Record<HudPanelId, { label: string; hint: string }> = {
  vitals: { label: "Vitals", hint: "Portrait, HP / SP and poise" },
  actionbar: { label: "Skill Bar", hint: "Bottom ability slots" },
  stats: { label: "Combat Readout", hint: "Clip, targets, FPS" },
  enemy: { label: "Enemy Panel", hint: "Locked target info" },
  status: { label: "Status Notifier", hint: "Buff / debuff chips" },
  reticle: { label: "Reticle", hint: "Aiming crosshair" },
  mech: { label: "Mech Cockpit", hint: "Armour integrity + slam (piloting only)" },
  tightbar: { label: "Tight Bar", hint: "Orbs, avatar + 12 slots (HUD Tight layout)" },
};

/* ------------------------------------------------------------------ *
 * HUD layouts. "classic" is the shipped bottom action bar; "tight"
 * (HUD_tight) swaps it for the Diablo-style bottom bar: health / mana
 * orbs on the ends, 6+6 quick slots and the avatar arch in the middle.
 * Purely additive: classic remains the default so the stock HUD is
 * untouched until the player opts in.
 * ------------------------------------------------------------------ */

export type HudLayoutId = "classic" | "tight";

export const HUD_LAYOUTS: Record<HudLayoutId, { name: string; blurb: string }> = {
  classic: { name: "Classic", blurb: "The stock bottom action bar." },
  tight: { name: "HUD Tight", blurb: "Health & mana orbs, avatar and 6+6 slots in one bottom bar." },
};

export const HUD_LAYOUT_IDS = Object.keys(HUD_LAYOUTS) as HudLayoutId[];

export function isHudLayoutId(v: unknown): v is HudLayoutId {
  return typeof v === "string" && v in HUD_LAYOUTS;
}

export interface PanelLayout {
  /** Horizontal offset in px from the panel's anchored position. */
  dx: number;
  /** Vertical offset in px. */
  dy: number;
  /** Uniform scale multiplier. */
  scale: number;
  /** When true the panel is removed from the HUD. */
  hidden: boolean;
}

/**
 * Fine-tune overrides layered on top of the active theme preset. Every field is
 * nullable; `null` means "inherit the preset's value", so an all-null appearance
 * is a no-op and the chosen theme renders exactly as authored.
 */
export interface HudAppearance {
  /** Overrides `--hud-accent` (primary). A `#rrggbb` / `#rgb` hex or null. */
  accent: string | null;
  /** Overrides `--hud-accent-2` (secondary). */
  accent2: string | null;
  /** Overrides `--hud-radius` corner rounding, in px. */
  radius: number | null;
  /** Glow strength multiplier applied to themed panel shadows. */
  glow: number | null;
  /** Overrides `--hud-font` with a font preset. */
  font: HudFontId | null;
}

export interface HudConfig {
  theme: HudThemeId;
  appearance: HudAppearance;
  panels: Record<HudPanelId, PanelLayout>;
  /** Which HUD layout renders: classic bottom bar or the HUD_tight bottom bar. */
  layout: HudLayoutId;
  /** HUD_tight quick-slot bindings: 12 slots (6 left grid + 6 right grid). */
  quickSlots: QuickSlots;
}

/**
 * A player-saved "look": a named snapshot of a theme preset plus its appearance
 * overlay. Panel layout is intentionally NOT captured — a look is about the
 * visual style, not where the panels sit.
 */
export interface HudCustomLook {
  id: string;
  name: string;
  theme: HudThemeId;
  appearance: HudAppearance;
}

export const HUD_STORAGE_KEY = "animator.hud.editor.v1";
export const HUD_LOOKS_STORAGE_KEY = "animator.hud.looks.v1";

/** Upper bounds for the saved-looks system so a hostile blob can't bloat storage. */
export const MAX_LOOKS = 50;
export const MAX_LOOK_NAME = 40;

export const MAX_OFFSET = 1200;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;

export const MIN_RADIUS = 0;
export const MAX_RADIUS = 32;
export const MIN_GLOW = 0;
export const MAX_GLOW = 2.5;

export function defaultPanelLayout(): PanelLayout {
  return { dx: 0, dy: 0, scale: 1, hidden: false };
}

export function defaultAppearance(): HudAppearance {
  return { accent: null, accent2: null, radius: null, glow: null, font: null };
}

export function defaultHudConfig(): HudConfig {
  const panels = {} as Record<HudPanelId, PanelLayout>;
  for (const id of HUD_PANEL_IDS) panels[id] = defaultPanelLayout();
  return {
    theme: "default",
    appearance: defaultAppearance(),
    panels,
    layout: "classic",
    quickSlots: defaultQuickSlots(),
  };
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** Accept only short, safe hex colors so a hostile blob can't inject CSS. */
function sanitizeHex(v: unknown): string | null {
  return typeof v === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : null;
}

function clampOptNum(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, v));
}

/** Clamp a (possibly partial / hostile) appearance blob into safe bounds. */
export function clampAppearance(raw: Partial<HudAppearance> | undefined): HudAppearance {
  return {
    accent: sanitizeHex(raw?.accent),
    accent2: sanitizeHex(raw?.accent2),
    radius: clampOptNum(raw?.radius, MIN_RADIUS, MAX_RADIUS),
    glow: clampOptNum(raw?.glow, MIN_GLOW, MAX_GLOW),
    font: isHudFontId(raw?.font) ? raw.font : null,
  };
}

/** Clamp a (possibly partial / hostile) panel layout into safe bounds. */
export function clampPanel(raw: Partial<PanelLayout> | undefined): PanelLayout {
  return {
    dx: clampNum(raw?.dx, -MAX_OFFSET, MAX_OFFSET, 0),
    dy: clampNum(raw?.dy, -MAX_OFFSET, MAX_OFFSET, 0),
    scale: clampNum(raw?.scale, MIN_SCALE, MAX_SCALE, 1),
    hidden: raw?.hidden === true,
  };
}

/**
 * Merge a persisted (untrusted) blob onto the defaults: unknown theme falls back
 * to default, every known panel is clamped, unknown panel ids are dropped, and
 * newly-introduced panels appear at their defaults so the editor never loses one.
 */
export function mergeConfig(raw: unknown): HudConfig {
  const base = defaultHudConfig();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as {
    theme?: unknown;
    appearance?: unknown;
    panels?: unknown;
    layout?: unknown;
    quickSlots?: unknown;
  };
  if (isHudThemeId(obj.theme)) base.theme = obj.theme;
  base.appearance = clampAppearance(obj.appearance as Partial<HudAppearance> | undefined);
  const panels = (obj.panels ?? {}) as Record<string, Partial<PanelLayout>>;
  if (panels && typeof panels === "object") {
    for (const id of HUD_PANEL_IDS) base.panels[id] = clampPanel(panels[id]);
  }
  if (isHudLayoutId(obj.layout)) base.layout = obj.layout;
  if (obj.quickSlots !== undefined) base.quickSlots = clampQuickSlots(obj.quickSlots);
  return base;
}

/**
 * Build the final flat CSS-variable map applied inline to the `.studio` root:
 * the active theme preset with the user's appearance overrides layered on top.
 * Only set keys differ from the preset, so the result stays minimal. The
 * `--hud-glow-strength` multiplier is always emitted (defaults to 1).
 */
export function resolveHudVars(config: HudConfig): Record<string, string> {
  const out: Record<string, string> = { ...hudThemeVars(config.theme) };
  const a = config.appearance;
  if (a.accent) out["--hud-accent"] = a.accent;
  if (a.accent2) out["--hud-accent-2"] = a.accent2;
  if (a.radius != null) out["--hud-radius"] = `${a.radius}px`;
  if (a.font) out["--hud-font"] = HUD_FONTS[a.font].stack;
  out["--hud-glow-strength"] = String(a.glow ?? 1);
  return out;
}

/** True when any appearance override is set (used to enable the reset action). */
export function hasAppearanceOverrides(a: HudAppearance): boolean {
  return (
    a.accent != null ||
    a.accent2 != null ||
    a.radius != null ||
    a.glow != null ||
    a.font != null
  );
}

export function loadHudConfig(storageKey = HUD_STORAGE_KEY): HudConfig {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) return mergeConfig(JSON.parse(raw));
  } catch {
    /* fall through to defaults */
  }
  return defaultHudConfig();
}

export function saveHudConfig(config: HudConfig, storageKey = HUD_STORAGE_KEY): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(config));
  } catch {
    /* storage may be unavailable; config stays in-memory */
  }
}

/* ------------------------------------------------------------------ *
 * Saved looks: named theme + appearance snapshots the player can keep,
 * re-apply and delete. Persisted under their own key in the same family.
 * ------------------------------------------------------------------ */

/** Trim and length-cap a (possibly hostile) look name. */
function sanitizeLookName(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_LOOK_NAME) : "";
}

/** Generate a reasonably-unique id, preferring crypto.randomUUID when present. */
export function makeLookId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the cheap fallback */
  }
  return `look_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a saved look from a name + the current config's theme & appearance. */
export function makeCustomLook(name: string, config: HudConfig): HudCustomLook {
  return {
    id: makeLookId(),
    name: sanitizeLookName(name),
    theme: config.theme,
    appearance: { ...config.appearance },
  };
}

/** Clamp a single (untrusted) look; returns null when it can't be salvaged. */
export function clampCustomLook(raw: unknown): HudCustomLook | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<HudCustomLook>;
  const name = sanitizeLookName(obj.name);
  if (!name) return null;
  return {
    id: typeof obj.id === "string" && obj.id ? obj.id : makeLookId(),
    name,
    theme: isHudThemeId(obj.theme) ? obj.theme : "default",
    appearance: clampAppearance(obj.appearance as Partial<HudAppearance> | undefined),
  };
}

/** Sanitize a persisted list of looks: drop invalid entries, dedupe ids, cap count. */
export function mergeCustomLooks(raw: unknown): HudCustomLook[] {
  if (!Array.isArray(raw)) return [];
  const out: HudCustomLook[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const look = clampCustomLook(entry);
    if (!look) continue;
    if (seen.has(look.id)) look.id = makeLookId();
    seen.add(look.id);
    out.push(look);
    if (out.length >= MAX_LOOKS) break;
  }
  return out;
}

export function loadCustomLooks(storageKey = HUD_LOOKS_STORAGE_KEY): HudCustomLook[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) return mergeCustomLooks(JSON.parse(raw));
  } catch {
    /* fall through to an empty list */
  }
  return [];
}

export function saveCustomLooks(
  looks: HudCustomLook[],
  storageKey = HUD_LOOKS_STORAGE_KEY,
): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(looks));
  } catch {
    /* storage may be unavailable; looks stay in-memory */
  }
}

/** True when a saved look exactly matches the config's current theme + appearance. */
export function lookMatchesConfig(look: HudCustomLook, config: HudConfig): boolean {
  if (look.theme !== config.theme) return false;
  const a = look.appearance;
  const b = config.appearance;
  return (
    a.accent === b.accent &&
    a.accent2 === b.accent2 &&
    a.radius === b.radius &&
    a.glow === b.glow &&
    a.font === b.font
  );
}
