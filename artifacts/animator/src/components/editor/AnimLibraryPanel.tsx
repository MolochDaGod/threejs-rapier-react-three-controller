import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, X, Zap } from "lucide-react";
import type { EditorScene } from "../../three/editor/EditorScene";
import type { EditorSnapshot } from "../../three/editor/types";
import { WEAPONS } from "../../three/assets";
import { VFX_PRESETS } from "../../three/editor/vfxCatalog";
import { CLIP_CATEGORIES, VERB_CATEGORY, verbLabel, humanizeClipId } from "../../three/ExplorerCharacter";
import { useClipLabels, type EffectKind, type SkillSlot } from "./useClipLabels";

/** Built-in category display order; user categories sort after, "Unsorted" always last. */
const CATEGORY_ORDER: string[] = CLIP_CATEGORIES.map((c) => c.label);

const SKILL_SLOTS: SkillSlot[] = [1, 2, 3, 4, 5];
const EFFECT_KINDS: EffectKind[] = ["melee", "ranged"];

/** VFX preset id → label, for compact binding badges. */
const VFX_LABEL = new Map(VFX_PRESETS.map((p) => [p.id, p.label]));
/** VFX presets grouped by their library group, for the binding <select>. */
const VFX_GROUPS = Array.from(new Set(VFX_PRESETS.map((p) => p.group))).map((g) => ({
  group: g,
  presets: VFX_PRESETS.filter((p) => p.group === g),
}));

interface Props {
  engine: EditorScene;
  snap: EditorSnapshot;
}

/** Pretty-print a catalog clip id (`animations/sword/outward-slash` → "Outward Slash"). */
const prettyId = (id: string) => humanizeClipId(id);

const CAT_LIST_ID = "ed-clip-categories";

interface ClipItem {
  /** Stable key the label store is keyed by. */
  key: string;
  /** Default (catalog) label shown when the user hasn't renamed the clip. */
  fallback: string;
  /** Built-in section this clip groups under when the user hasn't assigned a category. */
  defaultCat?: string;
  playing: boolean;
  onPlay: () => void;
}

type Labels = ReturnType<typeof useClipLabels>;

/**
 * A grouped, editable list of clips. Clips are grouped by the user's assigned
 * category (uncategorized fall under "Unsorted", always last). Each clip can be
 * renamed and re-categorized inline; both persist via the label store.
 */
function ClipList({
  items,
  labels,
  binding,
  playVfx,
}: {
  items: ClipItem[];
  labels: Labels;
  /** Enable the per-clip skill-binding editor (rig clips only). */
  binding?: boolean;
  /** Fire a VFX preset by id (used by the binding "Test" action). */
  playVfx?: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCat, setDraftCat] = useState("");
  const [bindOpen, setBindOpen] = useState<string | null>(null);
  // Every clip in this list is a slot sibling — assigning a slot to one clears it
  // from the others so the 1–5 loadout stays unambiguous.
  const siblingKeys = useMemo(() => items.map((i) => i.key), [items]);

  const groups = useMemo(() => {
    const m = new Map<string, ClipItem[]>();
    for (const it of items) {
      // User-assigned category wins; otherwise the clip's built-in section; else Unsorted.
      const cat = labels.store[it.key]?.category || it.defaultCat || "Unsorted";
      const arr = m.get(cat);
      if (arr) arr.push(it);
      else m.set(cat, [it]);
    }
    // Built-in sections keep their designed order; user categories sort alphabetically
    // after them; "Unsorted"/"Other" always trail.
    const rank = (c: string) => {
      if (c === "Unsorted" || c === "Other") return Number.MAX_SAFE_INTEGER;
      const i = CATEGORY_ORDER.indexOf(c);
      return i >= 0 ? i : CATEGORY_ORDER.length;
    };
    return [...m.entries()].sort((a, b) => {
      const ra = rank(a[0]);
      const rb = rank(b[0]);
      return ra !== rb ? ra - rb : a[0].localeCompare(b[0]);
    });
  }, [items, labels.store]);

  const startEdit = (it: ClipItem) => {
    setEditing(it.key);
    setDraftLabel(labels.store[it.key]?.label ?? "");
    setDraftCat(labels.store[it.key]?.category ?? "");
  };
  const save = (key: string) => {
    labels.setLabel(key, draftLabel);
    labels.setCategory(key, draftCat);
    setEditing(null);
  };
  const onKey = (e: React.KeyboardEvent, key: string) => {
    if (e.key === "Enter") save(key);
    else if (e.key === "Escape") setEditing(null);
  };

  return (
    <>
      {groups.map(([cat, list]) => (
        <div key={cat} className="ed-clip-group">
          <div className="ed-clip-cat">
            <span>{cat}</span>
            <span className="ct">{list.length}</span>
          </div>
          <div className="ed-list">
            {list.map((it) => {
              if (editing === it.key) {
                return (
                  <div key={it.key} className="ed-clip-edit">
                    <input
                      className="ed-input"
                      autoFocus
                      value={draftLabel}
                      placeholder={it.fallback}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      onKeyDown={(e) => onKey(e, it.key)}
                    />
                    <div className="ed-clip-edit-row">
                      <input
                        className="ed-input"
                        list={CAT_LIST_ID}
                        value={draftCat}
                        placeholder="Category (e.g. Gap Closers)…"
                        onChange={(e) => setDraftCat(e.target.value)}
                        onKeyDown={(e) => onKey(e, it.key)}
                      />
                      <button className="ed-tw" title="Save" onClick={() => save(it.key)}>
                        <Check size={14} />
                      </button>
                      <button className="ed-tw" title="Cancel" onClick={() => setEditing(null)}>
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                );
              }
              const name = labels.store[it.key]?.label || it.fallback;
              const meta = labels.store[it.key];
              const open = bindOpen === it.key;
              return (
                <div key={it.key}>
                  <div className={`ed-row ${it.playing ? "on" : ""}`}>
                    <span className="nm" title={`Play — ${it.fallback}`} onClick={it.onPlay}>
                      {name}
                    </span>
                    {binding && meta?.skill && !open && (
                      <span className="ed-skill-badge" title={`Skill ${meta.skill} — ${meta.effectKind ?? "melee"}${meta.vfx ? ` · ${VFX_LABEL.get(meta.vfx) ?? meta.vfx}` : ""}`}>
                        S{meta.skill}
                      </span>
                    )}
                    {binding && (
                      <button
                        className={`ed-tw${meta?.skill ? " bound" : ""}${open ? " on" : ""}`}
                        title="Bind to a skill slot"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBindOpen(open ? null : it.key);
                        }}
                      >
                        <Zap size={12} />
                      </button>
                    )}
                    <button
                      className="ed-tw"
                      title="Rename & categorize"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(it);
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <span style={{ opacity: 0.5, fontSize: 12, cursor: "pointer" }} onClick={it.onPlay}>
                      ▶
                    </span>
                  </div>
                  {binding && open && (
                    <div className="ed-skill-bind">
                      <div className="ed-skill-bind-label">Skill slot</div>
                      <div className="ed-skill-slots">
                        {SKILL_SLOTS.map((s) => (
                          <button
                            key={s}
                            className={`ed-skill-slot${meta?.skill === s ? " on" : ""}`}
                            title={`Bind to skill ${s}${meta?.skill === s ? " (click to clear)" : ""}`}
                            onClick={() => labels.setSkill(it.key, meta?.skill === s ? null : s, siblingKeys)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                      <div className="ed-skill-bind-label">Effect</div>
                      <div className="ed-seg">
                        {EFFECT_KINDS.map((k) => (
                          <button
                            key={k}
                            className={`${meta?.effectKind === k ? "on" : ""}`}
                            onClick={() => labels.setEffectKind(it.key, meta?.effectKind === k ? null : k)}
                          >
                            {k}
                          </button>
                        ))}
                      </div>
                      <div className="ed-skill-bind-label">VFX</div>
                      <select
                        className="ed-select"
                        value={meta?.vfx ?? ""}
                        onChange={(e) => labels.setVfx(it.key, e.target.value || null)}
                      >
                        <option value="">— none —</option>
                        {VFX_GROUPS.map((grp) => (
                          <optgroup key={grp.group} label={grp.group}>
                            {grp.presets.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <div className="ed-row-actions" style={{ marginTop: 8 }}>
                        <button
                          className="ed-btn"
                          title="Play the clip and fire its bound effect"
                          onClick={() => {
                            it.onPlay();
                            if (meta?.vfx) playVfx?.(meta.vfx);
                          }}
                        >
                          ▶ Test skill
                        </button>
                        <button className="ed-btn" onClick={() => setBindOpen(null)}>
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * The animation library: loads a procedural rig, swaps its weapon set, and lets
 * you preview every clip the active set ships. Every clip (rig + imported) can be
 * renamed and grouped into user categories so a vague catalog name like "attack"
 * can become "great 2h gap-closing jump" filed under your own organizing scheme.
 * Clips load asynchronously after a weapon swap, so we poll the engine briefly to
 * refresh the list.
 */
export function AnimLibraryPanel({ engine, snap }: Props) {
  const labels = useClipLabels();
  const loaded = snap.rigWeapon !== null;
  const hasImported = snap.importedClips.length > 0;

  // Async clips land after load/weapon-swap; nudge the engine to re-emit until
  // the list fills in (or we give up after ~12s) so no manual refresh is needed.
  useEffect(() => {
    if (!loaded) return;
    let n = 0;
    const t = setInterval(() => {
      engine.refresh();
      if (snap.rigClips.length > 0 || ++n > 30) clearInterval(t);
    }, 400);
    return () => clearInterval(t);
  }, [engine, loaded, snap.rigWeapon, snap.rigClips.length]);

  const rigItems = useMemo<ClipItem[]>(
    () =>
      snap.rigClips.map((c) => ({
        key: c,
        fallback: verbLabel(c),
        defaultCat: VERB_CATEGORY[c],
        playing: snap.rigPlaying === c,
        onPlay: () => engine.previewClip(c),
      })),
    [snap.rigClips, snap.rigPlaying, engine],
  );

  return (
    <div className="ed-panel grow">
      <div className="ed-panel-head">
        <span>Animations</span>
        {loaded && <span style={{ opacity: 0.6 }}>{snap.rigClips.length}</span>}
      </div>
      <div className="ed-panel-body">
        {/* Shared category suggestions for every clip's category input. */}
        <datalist id={CAT_LIST_ID}>
          {labels.categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        {/* Procedural rig library */}
        {!loaded ? (
          <>
            <div className="ed-empty">Load a rig to browse and preview the animation library.</div>
            <button className="ed-btn" style={{ width: "100%" }} onClick={() => void engine.loadRig("sword")}>
              Load rig
            </button>
          </>
        ) : (
          <>
            <div className="ed-field">
              <label className="ed-label">Weapon set</label>
              <select
                className="ed-select"
                value={WEAPONS.find((w) => w.animSet === snap.rigWeapon)?.id ?? "sword"}
                onChange={(e) => engine.setRigWeapon(e.target.value)}
              >
                {WEAPONS.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label} ({w.animSet})
                  </option>
                ))}
              </select>
            </div>

            <div className="ed-label">Rig clips — {snap.rigClips.length}</div>
            {snap.rigClips.length === 0 ? (
              <div className="ed-empty">Loading clips…</div>
            ) : (
              <ClipList items={rigItems} labels={labels} binding playVfx={(id) => engine.playVfx(id)} />
            )}

            <div className="ed-row-actions">
              <button className="ed-btn" onClick={() => engine.refresh()}>
                Refresh
              </button>
              <button className="ed-btn danger" onClick={() => engine.unloadRig()}>
                Unload
              </button>
            </div>
          </>
        )}

        {/* Mixamo clips auto-retargeted onto the dressed character on import */}
        {snap.rigImportedClips.length > 0 && (
          <div className="ed-imported-clips">
            <div className="ed-label" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Mixamo clips → character</span>
              {snap.rigImportedPlaying && (
                <button className="ed-tw" title="Stop" onClick={() => engine.stopRigImportedClip()}>
                  ◼
                </button>
              )}
            </div>
            {snap.rigImportedClips.map((g) => {
              const items: ClipItem[] = g.clips.map((c) => {
                const key = `${g.rootId}::${c}`;
                return {
                  key,
                  fallback: prettyId(c),
                  playing: snap.rigImportedPlaying === key,
                  onPlay: () => engine.playRigImportedClip(g.rootId, c),
                };
              });
              return (
                <div key={g.rootId} className="ed-field">
                  <div className="ed-label" style={{ opacity: 0.6 }}>
                    {g.name} — {g.clips.length}
                  </div>
                  <ClipList items={items} labels={labels} />
                </div>
              );
            })}
          </div>
        )}

        {/* Clips that rode in on imported GLB/FBX models */}
        {hasImported && (
          <div className="ed-imported-clips">
            <div className="ed-label" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Imported clips</span>
              {snap.importedPlaying && (
                <button className="ed-tw" title="Stop" onClick={() => engine.stopImportedClip()}>
                  ◼
                </button>
              )}
            </div>
            {snap.importedClips.map((g) => {
              const items: ClipItem[] = g.clips.map((c) => {
                const key = `${g.rootId}::${c}`;
                return {
                  key,
                  fallback: prettyId(c),
                  playing: snap.importedPlaying === key,
                  onPlay: () => engine.previewImportedClip(g.rootId, c),
                };
              });
              return (
                <div key={g.rootId} className="ed-field">
                  <div className="ed-label" style={{ opacity: 0.6 }}>
                    {g.name} — {g.clips.length}
                  </div>
                  <ClipList items={items} labels={labels} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
