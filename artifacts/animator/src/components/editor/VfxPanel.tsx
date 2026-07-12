import { useEffect, useState } from "react";
import type { EditorScene } from "../../three/editor/EditorScene";
import type { EditorSnapshot } from "../../three/editor/types";
import { VFX_PRESETS } from "../../three/editor/vfxCatalog";
import {
  FIRE_FX_RANGES,
  type FireFxNumKey,
  type FireFxParams,
  loadFireFx,
  saveFireFx,
} from "../../three/fxSettings";
import {
  SLASH_FX_RANGES,
  type SlashFxNumKey,
  type SlashFxParams,
  type SlashFxStore,
  loadSlashFx,
  saveSlashFx,
  slashFxFor,
} from "../../three/slashSettings";

interface Props {
  engine: EditorScene;
  snap: EditorSnapshot;
}

const GROUP_LABEL: Record<string, string> = {
  impact: "Impact",
  energy: "Energy",
  fire: "Fire",
  status: "Status",
};

const FIRE_SLIDERS: { key: FireFxNumKey; label: string }[] = [
  { key: "brightness", label: "Bright" },
  { key: "turbulence", label: "Turb" },
  { key: "sizeMult", label: "Size" },
  { key: "speedMult", label: "Speed" },
  { key: "sideBias", label: "Drift" },
];

const COLOR_STOPS: { key: keyof FireFxParams; label: string }[] = [
  { key: "core", label: "Core" },
  { key: "mid", label: "Mid" },
  { key: "edge", label: "Edge" },
  { key: "dark", label: "Dark" },
];

const SLASH_SLIDERS: { key: SlashFxNumKey; label: string; step: number; int?: boolean }[] = [
  { key: "rotate", label: "Rotate", step: 1, int: true },
  { key: "direction", label: "Direction", step: 1, int: true },
  { key: "scale", label: "Scale", step: 0.05 },
  { key: "bend", label: "Bend", step: 0.05 },
  { key: "thickness", label: "Thickness", step: 0.05 },
  { key: "particles", label: "Particles", step: 1, int: true },
];

/** The VFX library: fire any catalogued effect at the selection, tune fire FX and slash arcs. */
export function VfxPanel({ engine, snap }: Props) {
  const [fire, setFire] = useState<FireFxParams>(() => loadFireFx());
  const [slashStore, setSlashStore] = useState<SlashFxStore>(() => loadSlashFx());
  const [activeSlash, setActiveSlash] = useState(0);
  const [slashCount, setSlashCount] = useState(() => engine.slashCount());

  useEffect(() => {
    engine.setFireParams(fire);
  }, [engine, fire]);

  // The crescent GLB loads asynchronously; poll until the arc count is known.
  useEffect(() => {
    if (slashCount > 0) return;
    const t = setInterval(() => {
      const c = engine.slashCount();
      if (c > 0) {
        setSlashCount(c);
        clearInterval(t);
      }
    }, 400);
    return () => clearInterval(t);
  }, [engine, slashCount]);

  const target = snap.selectedId ? "selection" : "origin";
  const groups = Array.from(new Set(VFX_PRESETS.map((p) => p.group)));

  const patch = (p: Partial<FireFxParams>) => {
    const next = { ...fire, ...p };
    setFire(next);
    saveFireFx(next);
  };

  const cur = slashFxFor(slashStore, activeSlash);
  const patchSlash = (p: Partial<SlashFxParams>) => {
    const next = { ...slashStore, [activeSlash]: { ...cur, ...p } };
    setSlashStore(next);
    saveSlashFx(next);
  };

  return (
    <div className="ed-panel grow">
      <div className="ed-panel-head">
        <span>VFX Library</span>
        <span style={{ opacity: 0.6, textTransform: "none" }}>→ {target}</span>
      </div>
      <div className="ed-panel-body">
        {groups.map((g) => (
          <div key={g} style={{ marginBottom: 12 }}>
            <div className="ed-label">{GROUP_LABEL[g] ?? g}</div>
            <div className="ed-chip-row">
              {VFX_PRESETS.filter((p) => p.group === g).map((p) => (
                <button key={p.id} className="ed-chip" onClick={() => engine.playVfx(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="ed-divider" />
        <div className="ed-subhead">
          <span>Slash Arcs</span>
          <button className="ed-btn" onClick={() => engine.playSlash(activeSlash, cur)} disabled={slashCount === 0}>
            ▶ Play
          </button>
        </div>
        {slashCount === 0 ? (
          <p className="ed-hint" style={{ position: "static", transform: "none", display: "block", textAlign: "center" }}>
            Loading crescents…
          </p>
        ) : (
          <>
            <div className="ed-tabs wrap" style={{ marginBottom: 10 }}>
              {Array.from({ length: slashCount }, (_, i) => (
                <button
                  key={i}
                  className={`ed-tab${i === activeSlash ? " on" : ""}`}
                  onClick={() => setActiveSlash(i)}
                >
                  Slash {i + 1}
                </button>
              ))}
            </div>
            {SLASH_SLIDERS.map(({ key, label, step, int }) => {
              const [min, max] = SLASH_FX_RANGES[key];
              return (
                <div className="ed-slider-row" key={key}>
                  <span className="nm">{label}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={cur[key]}
                    onChange={(e) =>
                      patchSlash({ [key]: parseFloat(e.target.value) } as Partial<SlashFxParams>)
                    }
                  />
                  <span className="val">{int ? Math.round(cur[key]) : cur[key].toFixed(2)}</span>
                </div>
              );
            })}
            <div className="ed-label" style={{ marginTop: 8 }}>
              Tint
            </div>
            <div className="ed-colorbar">
              <input
                type="color"
                title="Tint"
                value={cur.color}
                onChange={(e) => patchSlash({ color: e.target.value })}
              />
            </div>
            <p className="ed-hint" style={{ position: "static", transform: "none", marginTop: 8, display: "block", textAlign: "center" }}>
              Particles = spark count (0 = none). Bend &amp; Thickness reshape the crescent.
            </p>
          </>
        )}

        <div className="ed-divider" />
        <div className="ed-subhead">Fire FX tuning</div>
        {FIRE_SLIDERS.map(({ key, label }) => {
          const [min, max] = FIRE_FX_RANGES[key];
          return (
            <div className="ed-slider-row" key={key}>
              <span className="nm">{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={0.05}
                value={fire[key]}
                onChange={(e) => patch({ [key]: parseFloat(e.target.value) } as Partial<FireFxParams>)}
              />
              <span className="val">{fire[key].toFixed(2)}</span>
            </div>
          );
        })}
        <div className="ed-label" style={{ marginTop: 8 }}>
          Palette
        </div>
        <div className="ed-colorbar">
          {COLOR_STOPS.map(({ key, label }) => (
            <input
              key={key}
              type="color"
              title={label}
              value={fire[key] as string}
              onChange={(e) => patch({ [key]: e.target.value } as Partial<FireFxParams>)}
            />
          ))}
        </div>
        <p className="ed-hint" style={{ position: "static", transform: "none", marginTop: 10, display: "block", textAlign: "center" }}>
          Effects play at the selected object, or world origin if nothing is selected.
        </p>
      </div>
    </div>
  );
}
