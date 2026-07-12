import type { EditorParams } from "../three/types";
import { FIRE_FX_RANGES, type FireFxParams, type FireFxNumKey } from "../three/fxSettings";
import { Icon } from "./Icon";

interface Props {
  open: boolean;
  params: EditorParams;
  onChange: (patch: Partial<EditorParams>) => void;
  /** Global simulation time-scale (1 = real time, < 1 = slow-motion). */
  timeScale: number;
  onTimeScale: (scale: number) => void;
  fireFx: FireFxParams;
  onFireFx: (patch: Partial<FireFxParams>) => void;
  onImpactTest: () => void;
  onClose: () => void;
  /** When false, render only the section bodies (hosted inside the dock shell). */
  chrome?: boolean;
}

interface SliderDef {
  key: keyof EditorParams;
  label: string;
  min: number;
  max: number;
  step: number;
}

const FIRE_SLIDERS: { key: FireFxNumKey; label: string; step: number }[] = [
  { key: "brightness", label: "Brightness", step: 0.05 },
  { key: "turbulence", label: "Turbulence", step: 0.05 },
  { key: "sizeMult", label: "Size", step: 0.1 },
  { key: "speedMult", label: "Speed", step: 0.05 },
  { key: "sideBias", label: "Side Bias", step: 0.05 },
];

const FIRE_COLORS: { key: keyof FireFxParams; label: string }[] = [
  { key: "core", label: "Core" },
  { key: "mid", label: "Mid" },
  { key: "edge", label: "Edge" },
  { key: "dark", label: "Dark" },
];

const SLIDERS: SliderDef[] = [
  { key: "moveSpeed", label: "Move Speed", min: 1, max: 10, step: 0.1 },
  { key: "sprintMultiplier", label: "Sprint x", min: 1, max: 3, step: 0.05 },
  { key: "jumpHeight", label: "Jump Height", min: 0.5, max: 5, step: 0.1 },
  { key: "gravity", label: "Gravity", min: 8, max: 40, step: 0.5 },
  { key: "cameraDistance", label: "Cam Distance", min: 2.5, max: 10, step: 0.1 },
  { key: "cameraHeight", label: "Cam Height", min: 0.5, max: 3, step: 0.05 },
  { key: "mouseSensitivity", label: "Mouse Sens", min: 0.2, max: 3, step: 0.05 },
  { key: "fov", label: "FOV", min: 40, max: 100, step: 1 },
  { key: "turnResponsiveness", label: "Turn Speed", min: 2, max: 25, step: 0.5 },
  { key: "blendTime", label: "Blend Time", min: 0.05, max: 0.6, step: 0.01 },
];

const COMBAT_SLIDERS: SliderDef[] = [
  { key: "dashDistance", label: "Dash Distance", min: 2, max: 12, step: 0.5 },
  { key: "aoeRadius", label: "AoE Radius", min: 1.5, max: 8, step: 0.5 },
  { key: "skillForce", label: "Skill Force", min: 4, max: 30, step: 1 },
  { key: "skyfallBolts", label: "Skyfall Bolts", min: 1, max: 12, step: 1 },
  { key: "attackSteer", label: "Attack Steer", min: 0, max: 1.5, step: 0.05 },
];

export function EditorPanel({ open, params, onChange, timeScale, onTimeScale, fireFx, onFireFx, onImpactTest, onClose, chrome = true }: Props) {
  if (chrome && !open) return null;
  const body = (
    <>
      <div className="panel-section">
        <h3>
          <Icon name="hud-settings" size={16} /> Simulation
        </h3>
        <label className="slider">
          <span className="slider-label">
            Time Scale
            <em>{timeScale.toFixed(2)}x</em>
          </span>
          <input
            type="range"
            min={0.1}
            max={2}
            step={0.05}
            value={timeScale}
            onChange={(e) => onTimeScale(parseFloat(e.target.value))}
          />
        </label>
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="camera" size={16} /> Model Facing
        </h3>
        <label className="slider">
          <span className="slider-label">
            Face Offset
            <em>{Math.round((params.modelYaw * 180) / Math.PI)}°</em>
          </span>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={Math.round((params.modelYaw * 180) / Math.PI)}
            onChange={(e) => onChange({ modelYaw: (parseFloat(e.target.value) * Math.PI) / 180 })}
          />
        </label>
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="movement-pad" size={16} /> Controller &amp; Camera
        </h3>
        {SLIDERS.map((s) => (
          <label key={s.key} className="slider">
            <span className="slider-label">
              {s.label}
              <em>{(params[s.key] as number).toFixed(2)}</em>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={params[s.key] as number}
              onChange={(e) => onChange({ [s.key]: parseFloat(e.target.value) })}
            />
          </label>
        ))}
        <label className="toggle">
          <input
            type="checkbox"
            checked={params.invertY}
            onChange={(e) => onChange({ invertY: e.target.checked })}
          />
          Invert mouse Y
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={params.showSkeleton}
            onChange={(e) => onChange({ showSkeleton: e.target.checked })}
          />
          Show skeleton
        </label>
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="action-bar" size={16} /> Combat
        </h3>
        {COMBAT_SLIDERS.map((s) => (
          <label key={s.key} className="slider">
            <span className="slider-label">
              {s.label}
              <em>{(params[s.key] as number).toFixed(2)}</em>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={params[s.key] as number}
              onChange={(e) => onChange({ [s.key]: parseFloat(e.target.value) })}
            />
          </label>
        ))}
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="action-bar" size={16} /> Flame FX
        </h3>
        <div className="color-row">
          {FIRE_COLORS.map((c) => (
            <label key={c.key} className="color-pick">
              <span>{c.label}</span>
              <input
                type="color"
                value={fireFx[c.key] as string}
                onChange={(e) => onFireFx({ [c.key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        {FIRE_SLIDERS.map((s) => {
          const [min, max] = FIRE_FX_RANGES[s.key];
          return (
            <label key={s.key} className="slider">
              <span className="slider-label">
                {s.label}
                <em>{fireFx[s.key].toFixed(2)}</em>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                step={s.step}
                value={fireFx[s.key]}
                onChange={(e) => onFireFx({ [s.key]: parseFloat(e.target.value) })}
              />
            </label>
          );
        })}
        <button className="fx-test-btn" onClick={onImpactTest}>
          Impact Explode
        </button>
      </div>
    </>
  );

  if (!chrome) return body;
  return (
    <div className="panel panel-right">
      <div className="panel-head">
        <h2>
          <Icon name="hud-settings" size={20} className="head-icon" /> Editor
        </h2>
        <button className="x" onClick={onClose}>
          ✕
        </button>
      </div>
      {body}
      <p className="panel-hint">
        Press <kbd>E</kbd> to toggle this panel.
      </p>
    </div>
  );
}
