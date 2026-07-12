/**
 * Avatar Edit — the cube modular head builder (6th door).
 *
 * Left: race picker + modular part slots (skin, hair, eyes, brows, facial
 * hair, ears, tusks, extras) with colour swatches. Right: live 3D cube head
 * ({@link HeadStage}) you can drag to orbit. Config persists to localStorage
 * and survives race hops (each race keeps its own last build).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ClipboardCopy, ClipboardPaste, Dices, DoorOpen, Download, Eye, EyeOff, Move3d, RotateCcw, Sparkles, UserCheck } from "lucide-react";
import { HeadStage } from "../three/avatar/HeadStage";
import { composeHead } from "../three/avatar/composeHead";
import {
  ADJUST_OFFSET_LIMIT,
  ADJUST_ROT_LIMIT,
  ADJUST_SCALE_MAX,
  ADJUST_SCALE_MIN,
  ADJUST_SLOTS,
  DEFAULT_ADJUST,
  earStylesFor,
  getAdjust,
  isDefaultAdjust,
  tuskStylesFor,
  type AdjustSlot,
  type PartAdjust,
  BROW_STYLES,
  EXPRESSIONS,
  EXTRA_STYLES,
  EYE_COLORS,
  EYE_STYLES,
  FACIAL_HAIR_STYLES,
  GEAR_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  HAT_STYLES,
  HEADGEAR_STYLES,
  MOUTH_STYLES,
  PAINT_COLORS,
  RACES,
  decodeConfig,
  defaultConfig,
  encodeConfig,
  randomConfig,
  raceDef,
  sanitizeConfig,
  surpriseConfig,
  type AvatarConfig,
  type RaceId,
} from "../three/avatar/catalog";
import { loadPlayerHeadConfig, savePlayerHeadConfig } from "../three/avatar/playerHead";
import { cssHex } from "../three/avatar/pixels";
import "./avatarEdit.css";

interface Props {
  onExit: () => void;
}

const STORE_KEY = "avatarEdit:builds:v1";
const LAST_RACE_KEY = "avatarEdit:lastRace:v1";

type Builds = Partial<Record<RaceId, AvatarConfig>>;

function loadLastRace(): RaceId {
  try {
    const raw = localStorage.getItem(LAST_RACE_KEY);
    if (raw && RACES.some((r) => r.id === raw)) return raw as RaceId;
  } catch {
    /* ignore */
  }
  return "human";
}

function loadBuilds(): Builds {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, unknown>;
    const out: Builds = {};
    for (const race of RACES) {
      const cfg = sanitizeConfig(raw[race.id]);
      if (cfg && cfg.race === race.id) out[race.id] = cfg;
    }
    return out;
  } catch {
    return {};
  }
}

function saveBuilds(builds: Builds): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(builds));
  } catch {
    /* storage full/blocked — editing still works, it just won't persist */
  }
}

export function AvatarEditMode({ onExit }: Props) {
  const buildsRef = useRef<Builds>(loadBuilds());
  const [cfg, setCfg] = useState<AvatarConfig>(() => {
    const race = loadLastRace();
    return buildsRef.current[race] ?? defaultConfig(race);
  });
  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HeadStage | null>(null);
  const [stageFailed, setStageFailed] = useState(false);
  const [savedToCharacter, setSavedToCharacter] = useState(false);
  const [codeNotice, setCodeNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notice = useCallback((msg: string) => {
    setCodeNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setCodeNotice(null), 2200);
  }, []);
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;
    let stage: HeadStage | null = null;
    try {
      stage = new HeadStage(mountRef.current);
    } catch (err) {
      // No WebGL (headless / blocked context): keep the editor usable.
      console.error("AvatarEdit: 3D stage unavailable", err);
      setStageFailed(true);
      return;
    }
    stageRef.current = stage;
    return () => {
      stage?.dispose();
      stageRef.current = null;
    };
  }, []);

  // Push every config change into the stage + persist per-race + last race.
  useEffect(() => {
    stageRef.current?.setConfig(cfg);
    buildsRef.current = { ...buildsRef.current, [cfg.race]: cfg };
    saveBuilds(buildsRef.current);
    try {
      localStorage.setItem(LAST_RACE_KEY, cfg.race);
    } catch {
      /* ignore */
    }
    // A new edit means the on-character head may be out of date again.
    setSavedToCharacter(false);
  }, [cfg]);

  const patch = useCallback((p: Partial<AvatarConfig>) => {
    setCfg((c) => ({ ...c, ...p }));
  }, []);

  const setAdjust = useCallback((slot: AdjustSlot, p: Partial<PartAdjust>) => {
    setCfg((c) => {
      const next = { ...(c.adjust?.[slot] ?? DEFAULT_ADJUST), ...p };
      const adjust: Partial<Record<AdjustSlot, PartAdjust>> = { ...(c.adjust ?? {}) };
      if (isDefaultAdjust(next)) delete adjust[slot];
      else adjust[slot] = next;
      if (Object.keys(adjust).length) return { ...c, adjust };
      const { adjust: _drop, ...rest } = c;
      return rest;
    });
  }, []);

  const switchRace = useCallback((race: RaceId) => {
    setCfg(buildsRef.current[race] ?? defaultConfig(race));
  }, []);

  const race = useMemo(() => raceDef(cfg.race), [cfg.race]);

  // --- placement (per-part offset / scale / hide) ---
  const activeSlots = useMemo(() => {
    const on: Record<AdjustSlot, boolean> = {
      hair: cfg.hair !== "bald",
      facialHair: cfg.facialHair !== "none",
      ears: cfg.ears !== "none",
      nose: true,
      tusks: cfg.tusks !== "none",
      headgear: cfg.headgear !== "none",
      hat: cfg.hat !== "none",
      extra: cfg.extra !== "none",
    };
    return ADJUST_SLOTS.filter((s) => on[s.id]);
  }, [cfg.hair, cfg.facialHair, cfg.ears, cfg.tusks, cfg.headgear, cfg.hat, cfg.extra]);

  const [adjSlot, setAdjSlot] = useState<AdjustSlot>("nose");
  const slot = activeSlots.some((s) => s.id === adjSlot) ? adjSlot : (activeSlots[0]?.id ?? "nose");
  const adj = getAdjust(cfg, slot);

  // Positional awareness: live centre + size of the selected part's 3D boxes.
  const partInfo = useMemo(() => {
    if (slot === "hat") return cfg.hat !== "none" ? { kind: "hat" as const } : null;
    const boxes = composeHead(cfg).protrusions.filter((b) => b.slot === slot);
    if (!boxes.length) return { kind: "painted" as const };
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x - b.w / 2);
      maxX = Math.max(maxX, b.x + b.w / 2);
      minY = Math.min(minY, b.y - b.h / 2);
      maxY = Math.max(maxY, b.y + b.h / 2);
      minZ = Math.min(minZ, b.z - b.d / 2);
      maxZ = Math.max(maxZ, b.z + b.d / 2);
    }
    return {
      kind: "boxes" as const,
      centre: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] as const,
      size: [maxX - minX, maxY - minY, maxZ - minZ] as const,
    };
  }, [cfg, slot]);

  const download = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const a = document.createElement("a");
    a.href = stage.exportFrontPng(cfg);
    a.download = `${cfg.race}-face.png`;
    a.click();
  }, [cfg]);

  const snapshot3d = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const a = document.createElement("a");
    a.href = stage.exportSnapshotPng();
    a.download = `${cfg.race}-head-3d.png`;
    a.click();
  }, [cfg.race]);

  const saveToCharacter = useCallback(() => {
    savePlayerHeadConfig(cfg);
    setSavedToCharacter(true);
    notice("Saved — your Explorer wears this head");
  }, [cfg, notice]);

  const copyCode = useCallback(() => {
    const code = encodeConfig(cfg);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(
        () => notice("Code copied"),
        () => window.prompt("Copy your avatar code:", code),
      );
    } else {
      window.prompt("Copy your avatar code:", code);
    }
  }, [cfg, notice]);

  const importCode = useCallback(() => {
    const raw = window.prompt("Paste an avatar code:");
    if (!raw) return;
    const parsed = decodeConfig(raw.trim());
    if (!parsed) {
      notice("That code didn't parse");
      return;
    }
    setCfg(parsed);
    notice("Avatar imported");
  }, [notice]);

  // On mount: reflect whether the current build is already the saved head.
  useEffect(() => {
    const saved = loadPlayerHeadConfig();
    if (saved && JSON.stringify(saved) === JSON.stringify(cfg)) setSavedToCharacter(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="avatar-edit">
      <header className="ae-head">
        <button className="ae-exit" onClick={onExit} aria-label="Back to doors">
          <DoorOpen size={16} />
        </button>
        <div className="ae-title">
          <span className="ae-brand">AVATAR EDIT</span>
          <span className="ae-sub">Cube modular head builder</span>
        </div>
        <div className="ae-actions">
          <button className="ae-act" onClick={() => setCfg(randomConfig(cfg.race))} title="Randomize this race">
            <Dices size={15} /> Randomize
          </button>
          <button className="ae-act" onClick={() => setCfg(surpriseConfig())} title="Random race, random everything">
            <Sparkles size={15} /> Surprise me
          </button>
          <button className="ae-act" onClick={() => setCfg(defaultConfig(cfg.race))} title="Reset to the race default">
            <RotateCcw size={15} /> Reset
          </button>
          <button className="ae-act" onClick={download} title="Download the face as pixel-art PNG">
            <Download size={15} /> PNG
          </button>
          <button className="ae-act" onClick={snapshot3d} title="Download a 3D portrait snapshot" disabled={stageFailed}>
            <Camera size={15} /> 3D shot
          </button>
          <button className="ae-act" onClick={copyCode} title="Copy this build as a shareable code">
            <ClipboardCopy size={15} /> Copy code
          </button>
          <button className="ae-act" onClick={importCode} title="Import a shared avatar code">
            <ClipboardPaste size={15} /> Import
          </button>
          <button
            className={`ae-act ae-save ${savedToCharacter ? "on" : ""}`}
            onClick={saveToCharacter}
            title="Use this head on your Explorer character in-game"
          >
            {savedToCharacter ? <Check size={15} /> : <UserCheck size={15} />}
            {savedToCharacter ? "On character" : "Save to character"}
          </button>
        </div>
        {codeNotice && <div className="ae-notice">{codeNotice}</div>}
      </header>

      <div className="ae-body">
        <aside className="ae-panel">
          <section className="ae-sec">
            <h3>Race</h3>
            <div className="ae-races">
              {RACES.map((r) => (
                <button
                  key={r.id}
                  className={`ae-race ${cfg.race === r.id ? "on" : ""}`}
                  onClick={() => switchRace(r.id)}
                >
                  <span className="ae-race-dot" style={{ background: cssHex(r.skins[0]) }} />
                  <span className="ae-race-name">{r.label}</span>
                  <span className="ae-race-blurb">{r.blurb}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="ae-sec">
            <h3>Skin tone</h3>
            <div className="ae-swatches">
              {race.skins.map((c, i) => (
                <Swatch key={i} color={c} on={cfg.skin === i} onPick={() => patch({ skin: i })} />
              ))}
            </div>
          </section>

          <section className="ae-sec">
            <h3>Hair</h3>
            <Chips items={HAIR_STYLES} value={cfg.hair} onPick={(hair) => patch({ hair })} />
            {cfg.hair !== "bald" && (
              <div className="ae-swatches">
                {HAIR_COLORS.map((c) => (
                  <Swatch key={c} color={c} on={cfg.hairColor === c} onPick={() => patch({ hairColor: c })} />
                ))}
              </div>
            )}
          </section>

          <section className="ae-sec">
            <h3>Eyes</h3>
            <Chips items={EYE_STYLES} value={cfg.eyes} onPick={(eyes) => patch({ eyes })} />
            <div className="ae-swatches">
              {EYE_COLORS.map((c) => (
                <Swatch key={c} color={c} on={cfg.eyeColor === c} onPick={() => patch({ eyeColor: c })} />
              ))}
            </div>
          </section>

          <section className="ae-sec">
            <h3>Brows</h3>
            <Chips items={BROW_STYLES} value={cfg.brows} onPick={(brows) => patch({ brows })} />
          </section>

          <section className="ae-sec">
            <h3>Mouth</h3>
            <Chips items={MOUTH_STYLES} value={cfg.mouth} onPick={(mouth) => patch({ mouth })} />
          </section>

          <section className="ae-sec">
            <h3>Expression</h3>
            <Chips
              items={EXPRESSIONS}
              value={cfg.expression}
              onPick={(expression) => patch({ expression })}
            />
          </section>

          <section className="ae-sec">
            <h3>Facial hair</h3>
            <Chips
              items={FACIAL_HAIR_STYLES}
              value={cfg.facialHair}
              onPick={(facialHair) => patch({ facialHair })}
            />
            {cfg.facialHair !== "none" && (
              <div className="ae-swatches">
                {HAIR_COLORS.map((c) => (
                  <Swatch
                    key={c}
                    color={c}
                    on={cfg.facialHairColor === c}
                    onPick={() => patch({ facialHairColor: c })}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="ae-sec">
            <h3>Ears</h3>
            <Chips items={earStylesFor(cfg.race)} value={cfg.ears} onPick={(ears) => patch({ ears })} />
          </section>

          {tuskStylesFor(cfg.race).length > 1 && (
            <section className="ae-sec">
              <h3>Tusks</h3>
              <Chips items={tuskStylesFor(cfg.race)} value={cfg.tusks} onPick={(tusks) => patch({ tusks })} />
            </section>
          )}

          <section className="ae-sec">
            <h3>Headgear</h3>
            <Chips items={HEADGEAR_STYLES} value={cfg.headgear} onPick={(headgear) => patch({ headgear })} />
            {cfg.headgear !== "none" && (
              <div className="ae-swatches">
                {GEAR_COLORS.map((c) => (
                  <Swatch key={c} color={c} on={cfg.headgearColor === c} onPick={() => patch({ headgearColor: c })} />
                ))}
              </div>
            )}
          </section>

          <section className="ae-sec">
            <h3>Hat</h3>
            <Chips items={HAT_STYLES} value={cfg.hat} onPick={(hat) => patch({ hat })} />
          </section>

          <section className="ae-sec">
            <h3>Extras</h3>
            <Chips items={EXTRA_STYLES} value={cfg.extra} onPick={(extra) => patch({ extra })} />
            {cfg.extra === "warpaint" && (
              <div className="ae-swatches">
                {PAINT_COLORS.map((c) => (
                  <Swatch key={c} color={c} on={cfg.extraColor === c} onPick={() => patch({ extraColor: c })} />
                ))}
              </div>
            )}
          </section>

          <section className="ae-sec ae-adjust">
            <h3>
              <Move3d size={13} /> Placement &amp; scale
            </h3>
            <div className="ae-chips">
              {activeSlots.map((s) => {
                const touched = cfg.adjust?.[s.id] !== undefined;
                return (
                  <button
                    key={s.id}
                    className={`ae-chip ${slot === s.id ? "on" : ""} ${touched ? "tweaked" : ""}`}
                    onClick={() => setAdjSlot(s.id)}
                  >
                    {s.label}
                    {touched ? " •" : ""}
                  </button>
                );
              })}
            </div>

            <div className="ae-adj-tools">
              <button
                className={`ae-act ae-adj-hide ${adj.hide ? "on" : ""}`}
                onClick={() => setAdjust(slot, { hide: !adj.hide })}
                title={adj.hide ? "Show this part" : "Hide this part"}
              >
                {adj.hide ? <EyeOff size={14} /> : <Eye size={14} />}
                {adj.hide ? "Hidden" : "Visible"}
              </button>
              <button
                className="ae-act"
                onClick={() => setAdjust(slot, { ...DEFAULT_ADJUST })}
                disabled={isDefaultAdjust(adj)}
                title="Reset this part's placement"
              >
                <RotateCcw size={14} /> Reset part
              </button>
            </div>

            {!adj.hide && (
              <div className="ae-adj-sliders">
                {(
                  [
                    ["X", "x", "left − / right +"],
                    ["Y", "y", "down − / up +"],
                    ["Z", "z", "back − / front +"],
                  ] as const
                )
                  .filter(([, axis]) => !(slot === "extra" && axis === "z"))
                  .map(([label, axis, hint]) => (
                    <AdjustRow
                      key={axis}
                      label={label}
                      hint={hint}
                      min={-ADJUST_OFFSET_LIMIT * 16}
                      max={ADJUST_OFFSET_LIMIT * 16}
                      step={0.25}
                      value={adj[axis] * 16}
                      display={`${adj[axis] >= 0 ? "+" : ""}${(adj[axis] * 16).toFixed(2)} px`}
                      onChange={(v) => setAdjust(slot, { [axis]: v / 16 })}
                    />
                  ))}
                {slot === "hat" &&
                  (
                    [
                      ["RX", "rotX", "tilt forward / back"],
                      ["RY", "rotY", "spin left / right"],
                      ["RZ", "rotZ", "tilt sideways"],
                    ] as const
                  ).map(([label, axis, hint]) => (
                    <AdjustRow
                      key={axis}
                      label={label}
                      hint={hint}
                      min={-ADJUST_ROT_LIMIT}
                      max={ADJUST_ROT_LIMIT}
                      step={5}
                      value={adj[axis]}
                      display={`${adj[axis] >= 0 ? "+" : ""}${adj[axis].toFixed(0)}°`}
                      onChange={(v) => setAdjust(slot, { [axis]: v })}
                    />
                  ))}
                {slot === "extra" && (
                  <AdjustRow
                    label="R"
                    hint="rotate the decal"
                    min={-ADJUST_ROT_LIMIT}
                    max={ADJUST_ROT_LIMIT}
                    step={5}
                    value={adj.rotZ}
                    display={`${adj.rotZ >= 0 ? "+" : ""}${adj.rotZ.toFixed(0)}°`}
                    onChange={(v) => setAdjust(slot, { rotZ: v })}
                  />
                )}
                <AdjustRow
                  label="S"
                  hint="part scale"
                  min={ADJUST_SCALE_MIN}
                  max={ADJUST_SCALE_MAX}
                  step={0.05}
                  value={adj.scale}
                  display={`×${adj.scale.toFixed(2)}`}
                  onChange={(v) => setAdjust(slot, { scale: v })}
                />
              </div>
            )}

            <div className="ae-adj-info">
              {partInfo?.kind === "boxes" && (
                <>
                  centre{" "}
                  {partInfo.centre.map((v, i) => (
                    <span key={i} className="ae-adj-num">
                      {"XYZ"[i]} {v >= 0 ? "+" : ""}
                      {(v * 16).toFixed(1)}
                    </span>
                  ))}{" "}
                  · size {partInfo.size.map((v) => (v * 16).toFixed(1)).join(" × ")} px
                </>
              )}
              {partInfo?.kind === "hat" && <>3D hat — offsets in head pixels, base rides the crown</>}
              {partInfo?.kind === "painted" &&
                (slot === "extra" ? (
                  <>painted decal — X/Y slide it, R rotates, S scales it on the face; Hide removes it</>
                ) : (
                  <>painted-on detail — X/Y/Z &amp; scale move only 3D pieces; Hide removes it</>
                ))}
            </div>
          </section>
        </aside>

        <div className="ae-stage" ref={mountRef}>
          {stageFailed ? (
            <span className="ae-stage-hint">3D preview unavailable (WebGL required)</span>
          ) : (
            <span className="ae-stage-hint">drag to orbit · scroll to zoom</span>
          )}
        </div>
      </div>
    </div>
  );
}

function AdjustRow({
  label,
  hint,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="ae-adj-row" title={hint}>
      <span className="ae-adj-axis">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} — ${hint}`}
      />
      <span className="ae-adj-val">{display}</span>
    </label>
  );
}

function Chips<T extends string>({
  items,
  value,
  onPick,
}: {
  items: { id: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="ae-chips">
      {items.map((s) => (
        <button key={s.id} className={`ae-chip ${value === s.id ? "on" : ""}`} onClick={() => onPick(s.id)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

function Swatch({ color, on, onPick }: { color: number; on: boolean; onPick: () => void }) {
  return (
    <button
      className={`ae-swatch ${on ? "on" : ""}`}
      style={{ background: cssHex(color) }}
      onClick={onPick}
      aria-label={`Colour ${cssHex(color)}`}
    />
  );
}
