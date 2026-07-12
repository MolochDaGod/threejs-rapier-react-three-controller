import { useCallback, useMemo, useState } from "react";

/** Skill loadout slot a clip can be bound to (1–5). */
export type SkillSlot = 1 | 2 | 3 | 4 | 5;
/** Whether a bound skill resolves its effect at range or in melee. */
export type EffectKind = "ranged" | "melee";

/** A user-authored label, organizing category, and optional skill binding for a clip. */
export interface ClipMeta {
  label?: string;
  category?: string;
  /** Skill loadout slot (1–5) this clip is bound to, if any. */
  skill?: SkillSlot;
  /** Whether the bound skill is a ranged or melee effect. */
  effectKind?: EffectKind;
  /** VFX preset id (from the VFX library) fired by the bound skill. */
  vfx?: string;
}

type Store = Record<string, ClipMeta>;

const STORAGE_KEY = "animator.dressing-room.clip-labels.v1";

/** Every optional field, used to prune empties so the store stays compact. */
const META_KEYS: (keyof ClipMeta)[] = ["label", "category", "skill", "effectKind", "vfx"];

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* storage unavailable — fall back to empty */
  }
  return {};
}

function persist(store: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* best-effort persistence */
  }
}

/** Apply a patch to one clip's metadata, pruning emptied fields (and the entry if it empties). */
function withMeta(store: Store, key: string, patch: Partial<ClipMeta>): Store {
  const merged: ClipMeta = { ...store[key], ...patch };
  for (const k of META_KEYS) if (!merged[k]) delete merged[k];
  const next = { ...store };
  if (Object.keys(merged).length === 0) delete next[key];
  else next[key] = merged;
  return next;
}

/**
 * Persistent, per-clip naming + categorization + skill-binding layer used by the
 * Animations panel. Catalog clip ids are immutable/shared, so user renames,
 * groupings, and skill loadout bindings live here (localStorage) keyed by the
 * clip's stable key instead of mutating the clips themselves. Empty metadata is
 * pruned so the store stays compact.
 */
export function useClipLabels() {
  const [store, setStore] = useState<Store>(load);

  const update = useCallback((key: string, patch: Partial<ClipMeta>) => {
    setStore((cur) => {
      const next = withMeta(cur, key, patch);
      persist(next);
      return next;
    });
  }, []);

  const setLabel = useCallback((key: string, label: string) => update(key, { label: label.trim() }), [update]);
  const setCategory = useCallback((key: string, category: string) => update(key, { category: category.trim() }), [update]);
  const setEffectKind = useCallback((key: string, kind: EffectKind | null) => update(key, { effectKind: kind ?? undefined }), [update]);
  const setVfx = useCallback((key: string, vfx: string | null) => update(key, { vfx: vfx || undefined }), [update]);

  /**
   * Bind (or clear, when `slot` is null) a clip to a skill slot. Slots are unique
   * within a loadout, so assigning a slot clears it from any sibling clip that
   * currently holds it — keeping the 1–5 loadout unambiguous per weapon set.
   */
  const setSkill = useCallback((key: string, slot: SkillSlot | null, siblingKeys: string[] = []) => {
    setStore((cur) => {
      let next = cur;
      if (slot) {
        for (const sib of siblingKeys) {
          if (sib !== key && next[sib]?.skill === slot) next = withMeta(next, sib, { skill: undefined });
        }
        next = withMeta(next, key, { skill: slot });
      } else {
        next = withMeta(next, key, { skill: undefined });
      }
      persist(next);
      return next;
    });
  }, []);

  /** Distinct user categories (for the assign datalist), alphabetically. */
  const categories = useMemo(
    () =>
      Array.from(new Set(Object.values(store).map((m) => m.category).filter((c): c is string => !!c))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [store],
  );

  return { store, setLabel, setCategory, setSkill, setEffectKind, setVfx, categories };
}
