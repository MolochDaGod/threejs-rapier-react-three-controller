import { useEffect, useState } from "react";
import type { RoomPreset } from "../three/RoomPresets";
import { renderEnvThumbnail } from "../three/envThumbnails";

const hexColor = (n: number) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);

/**
 * A small CSS approximation of a preset, built from its own colours. Used as a
 * placeholder while the real render is in flight and as a graceful fallback when
 * WebGL is unavailable.
 */
function EnvThumbSwatch({ preset }: { preset: RoomPreset }) {
  const floor = hexColor(preset.floorColor);
  const wall = hexColor(preset.wallColor);
  const accent = hexColor(preset.pillarGlowColor);
  const grid = preset.gridOpacity > 0 ? hexColor(preset.gridColor1) : null;
  return (
    <span className="env-thumb" style={{ background: `linear-gradient(180deg, ${wall} 0%, ${floor} 100%)` }} aria-hidden>
      {grid && (
        <span
          className="env-thumb-grid"
          style={{
            backgroundImage: `linear-gradient(${grid} 1px, transparent 1px), linear-gradient(90deg, ${grid} 1px, transparent 1px)`,
          }}
        />
      )}
      <span className="env-thumb-glow" style={{ background: accent, boxShadow: `0 0 6px 1px ${accent}` }} />
    </span>
  );
}

/**
 * Environment preset preview: a true offscreen Three.js render of the built room
 * (captured once, cached). Falls back to the CSS swatch while the render is in
 * flight or if WebGL is unavailable. Shared so every surface that lets users
 * choose (or is shown) a training environment renders the same thumbnail as the
 * Danger Room menubar picker.
 */
export function EnvThumb({ preset }: { preset: RoomPreset }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    renderEnvThumbnail(preset.id).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [preset.id]);
  if (!src) return <EnvThumbSwatch preset={preset} />;
  return <img className="env-thumb" src={src} alt="" aria-hidden draggable={false} />;
}

/**
 * The {@link EnvThumb} thumbnail paired with the preset's name + one-line blurb,
 * matching the menubar picker entry. Use this on surfaces (e.g. duel/session
 * setup) that show which environment a contest will take place in.
 */
export function EnvPreview({ preset }: { preset: RoomPreset }) {
  return (
    <div className="env-preview">
      <EnvThumb preset={preset} />
      <div className="env-preview-text">
        <span className="env-preview-name">{preset.name}</span>
        <span className="env-preview-blurb">{preset.blurb}</span>
      </div>
    </div>
  );
}
