/**
 * Persist voxel (Explorer) character looks on open.grudge-studio.com.
 *
 * Local SSOT: localStorage (always).
 * Fleet SSOT when signed in: `saveData.open.voxelLook` via characterLoadout.
 *
 * Used by Dressing Room "Save avatar", Campfire lobby seats, and Explorer load.
 */
import type { CharacterLook } from "./types";
import type { VoxelPart } from "./rig";
import type { ShellId } from "../LedMaskShells";
import { DEFAULT_LOOK } from "./loader";

export const VOXEL_AVATAR_KEY = "avatarEdit:voxelLook:v1";
export const VOXEL_AVATAR_EVENT = "voxelAvatar:saved";

/** Serializable voxel avatar (colours + hat/cape/LED — no pattern bitmaps). */
export type VoxelAvatarSave = {
  version: 1;
  skin: string;
  shirt: string;
  pants: string;
  boot: string;
  eye: string;
  hat: CharacterLook["hat"];
  hatColor: string;
  cape: boolean;
  capeColor: string;
  ledShell?: ShellId;
  /** Fleet character id when saved from a selected hero. */
  characterId?: string;
  updatedAt: number;
};

const HEX = /^#?[0-9a-fA-F]{6}$/;

function asHex(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.startsWith("#") ? v : `#${v}`;
  return HEX.test(s) ? (s.startsWith("#") ? s : `#${s}`) : fallback;
}

function asHat(v: unknown): CharacterLook["hat"] {
  if (v === "cap" || v === "horns" || v === "ledMask" || v === "none") return v;
  return "none";
}

/** Validate / normalise a raw object into a save blob. */
export function sanitizeVoxelAvatar(raw: unknown): VoxelAvatarSave | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const base = DEFAULT_LOOK;
  return {
    version: 1,
    skin: asHex(o.skin, base.skin),
    shirt: asHex(o.shirt, base.shirt),
    pants: asHex(o.pants, base.pants),
    boot: asHex(o.boot, "#2a2a32"),
    eye: asHex(o.eye, "#15151b"),
    hat: asHat(o.hat),
    hatColor: asHex(o.hatColor, base.hatColor),
    cape: o.cape === true,
    capeColor: asHex(o.capeColor, base.capeColor ?? "#1a1e2b"),
    ledShell: typeof o.ledShell === "string" ? (o.ledShell as ShellId) : undefined,
    characterId: typeof o.characterId === "string" ? o.characterId : undefined,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
  };
}

export function voxelAvatarToLook(save: VoxelAvatarSave): CharacterLook {
  return {
    skin: save.skin,
    shirt: save.shirt,
    pants: save.pants,
    hat: save.hat,
    hatColor: save.hatColor,
    cape: save.cape,
    capeColor: save.capeColor,
    ledShell: save.ledShell,
    avatarHead: save.hat !== "ledMask",
  };
}

export function lookToVoxelAvatar(
  look: Partial<CharacterLook> & { boot?: string; eye?: string },
  characterId?: string,
): VoxelAvatarSave {
  const base = DEFAULT_LOOK;
  return {
    version: 1,
    skin: look.skin ?? base.skin,
    shirt: look.shirt ?? base.shirt,
    pants: look.pants ?? base.pants,
    boot: look.boot ?? "#2a2a32",
    eye: look.eye ?? "#15151b",
    hat: look.hat ?? "none",
    hatColor: look.hatColor ?? base.hatColor,
    cape: look.cape === true,
    capeColor: look.capeColor ?? base.capeColor ?? "#1a1e2b",
    ledShell: look.ledShell,
    characterId,
    updatedAt: Date.now(),
  };
}

/** Global (any character) saved look. */
export function loadVoxelAvatar(): VoxelAvatarSave | null {
  try {
    const raw = localStorage.getItem(VOXEL_AVATAR_KEY);
    if (!raw) return null;
    return sanitizeVoxelAvatar(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Per-character override when present. */
export function loadVoxelAvatarForCharacter(characterId: string | null | undefined): VoxelAvatarSave | null {
  if (characterId) {
    try {
      const raw = localStorage.getItem(`${VOXEL_AVATAR_KEY}:${characterId}`);
      if (raw) {
        const s = sanitizeVoxelAvatar(JSON.parse(raw));
        if (s) return s;
      }
    } catch {
      /* ignore */
    }
  }
  return loadVoxelAvatar();
}

/**
 * Persist voxel avatar locally (+ optional per-character key).
 * Dispatches {@link VOXEL_AVATAR_EVENT} for live Studio / campfire refresh.
 */
export function saveVoxelAvatar(save: VoxelAvatarSave): void {
  const clean = sanitizeVoxelAvatar(save);
  if (!clean) return;
  try {
    localStorage.setItem(VOXEL_AVATAR_KEY, JSON.stringify(clean));
    if (clean.characterId) {
      localStorage.setItem(`${VOXEL_AVATAR_KEY}:${clean.characterId}`, JSON.stringify(clean));
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(VOXEL_AVATAR_EVENT, { detail: clean }));
    }
  } catch {
    /* storage full/blocked */
  }
}

/** Merge part colour overrides onto a live rig after construction. */
export function partOverridesFromSave(save: VoxelAvatarSave): Partial<Record<VoxelPart, string>> {
  return {
    skin: save.skin,
    shirt: save.shirt,
    pants: save.pants,
    boot: save.boot,
    eye: save.eye,
    hat: save.hatColor,
  };
}

/** Prefer character saveData.open.voxelLook, else localStorage. */
export function resolveVoxelAvatar(
  characterId: string | null | undefined,
  openBlob?: Record<string, unknown> | null,
): VoxelAvatarSave | null {
  if (openBlob?.voxelLook) {
    const fromFleet = sanitizeVoxelAvatar(openBlob.voxelLook);
    if (fromFleet) return fromFleet;
  }
  return loadVoxelAvatarForCharacter(characterId);
}
