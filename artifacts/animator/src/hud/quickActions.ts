// Bindable quick actions for the HUD_tight layout's 6+6 side quick menus.
// Pure data (icon names are type-only imports) so it is unit-testable without
// a DOM and safe to import from hudConfig's clamp/merge logic.

import type { IconName } from "../three/icons";

/** Everything a HUD_tight quick-menu slot can be bound to. */
export type QuickActionId =
  | "primary"
  | "fskill"
  | "sig1"
  | "sig2"
  | "sig3"
  | "sig4"
  | "heavy"
  | "parry"
  | "block"
  | "dodge"
  | "bomb"
  | "heal";

export type QuickActionKind = "action" | "skill" | "item";

export interface QuickAction {
  id: QuickActionId;
  /** Friendly name shown under the slot (skills may override with live data). */
  label: string;
  /** Framed RPG icon name (see three/icons.ts). */
  icon: IconName;
  /** Input key/button label, e.g. "LMB", "F", "Q". */
  key: string;
  kind: QuickActionKind;
}

export const QUICK_ACTIONS: Record<QuickActionId, QuickAction> = {
  primary: { id: "primary", label: "Attack", icon: "attack", key: "LMB", kind: "action" },
  fskill: { id: "fskill", label: "Weapon Skill", icon: "skill-vfx-lab", key: "F", kind: "skill" },
  sig1: { id: "sig1", label: "Signature 1", icon: "scout", key: "1", kind: "skill" },
  sig2: { id: "sig2", label: "Signature 2", icon: "ambush", key: "2", kind: "skill" },
  sig3: { id: "sig3", label: "Signature 3", icon: "siege", key: "3", kind: "skill" },
  sig4: { id: "sig4", label: "Signature 4", icon: "skill-vfx-lab", key: "4", kind: "skill" },
  heavy: { id: "heavy", label: "Heavy / Skyfall", icon: "charge", key: "R", kind: "action" },
  parry: { id: "parry", label: "Parry", icon: "rally", key: "Q", kind: "action" },
  block: { id: "block", label: "Block", icon: "guard", key: "E", kind: "action" },
  dodge: { id: "dodge", label: "Dodge", icon: "retreat", key: "X", kind: "action" },
  bomb: { id: "bomb", label: "Bomb", icon: "siege", key: "H", kind: "item" },
  heal: { id: "heal", label: "Heal Tonic", icon: "rest", key: "J", kind: "item" },
};

export const QUICK_ACTION_IDS = Object.keys(QUICK_ACTIONS) as QuickActionId[];

export function isQuickActionId(v: unknown): v is QuickActionId {
  return typeof v === "string" && v in QUICK_ACTIONS;
}

/** 6 slots per side column. */
export const QUICK_SLOTS_PER_SIDE = 6;
/** Total quick-menu slots (left column + right column). */
export const QUICK_SLOT_COUNT = QUICK_SLOTS_PER_SIDE * 2;

/** A slot binding: a quick action id, or null for an empty slot. */
export type QuickSlots = (QuickActionId | null)[];

/**
 * Default 6+6 loadout: offense/skills down the left, defense + signatures +
 * items down the right. Every shipped action gets a home so the tight layout
 * is fully populated out of the box.
 */
export function defaultQuickSlots(): QuickSlots {
  return [
    // Left column (top → bottom)
    "primary",
    "fskill",
    "sig1",
    "sig2",
    "sig3",
    "sig4",
    // Right column (top → bottom)
    "heavy",
    "parry",
    "block",
    "dodge",
    "bomb",
    "heal",
  ];
}

/**
 * Clamp a (possibly hostile) persisted quick-slot list: unknown ids become
 * empty slots, and the list is padded/truncated to exactly QUICK_SLOT_COUNT.
 * A missing list falls back to the default loadout.
 */
export function clampQuickSlots(raw: unknown): QuickSlots {
  if (!Array.isArray(raw)) return defaultQuickSlots();
  const out: QuickSlots = [];
  for (let i = 0; i < QUICK_SLOT_COUNT; i++) {
    const v = raw[i];
    out.push(isQuickActionId(v) ? v : null);
  }
  return out;
}
