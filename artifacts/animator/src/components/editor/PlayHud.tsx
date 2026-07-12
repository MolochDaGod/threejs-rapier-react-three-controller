import { useEffect, useRef, useState } from "react";
import type { PlayHudState } from "../../three/editor/types";

/**
 * Game-style combat HUD shown while the Dressing Room is in Play mode: a vitals
 * bar plus the driven character's weapon-skill bar (LMB + 1-5) with live
 * cooldown sweeps. The engine only re-emits a snapshot when a skill fires (it
 * stamps each slot's `readyAt`); this component self-animates the sweep with its
 * own rAF so the dial drains smoothly without per-frame React churn from the
 * engine.
 */
export function PlayHud({ hud }: { hud: PlayHudState | null }) {
  const [, force] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (!hud) return;
    // Demand-driven: the engine only re-emits a snapshot when a skill fires, so
    // spin the rAF sweep up only while something is actually on cooldown and let
    // it stop itself once every slot is ready again (no idle 60fps React churn).
    const cooling = () => hud.skills.some((s) => s.cooldown > 0 && s.readyAt > performance.now());
    const tick = () => {
      force((n) => (n + 1) % 1_000_000);
      raf.current = cooling() ? requestAnimationFrame(tick) : 0;
    };
    if (cooling()) raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [hud]);

  if (!hud) return null;
  const now = performance.now();
  const hpPct = Math.round(Math.max(0, Math.min(1, hud.health)) * 100);

  return (
    <div className="play-hud">
      <div className="play-hud-vitals">
        <div className="play-hud-bar">
          <div className="play-hud-fill" style={{ width: `${hpPct}%` }} />
          <span className="play-hud-bar-label">HP</span>
        </div>
      </div>
      <div className="play-hud-skills">
        {hud.skills.map((s) => {
          const remaining = s.cooldown > 0 ? Math.max(0, (s.readyAt - now) / 1000) : 0;
          const pct = s.cooldown > 0 ? Math.max(0, Math.min(1, remaining / s.cooldown)) : 0;
          const ready = remaining <= 0;
          return (
            <div
              key={s.key}
              className={`play-skill${ready ? " ready" : " cooling"}`}
              data-tip={s.bind ? `${s.label} — press ${s.bind}` : s.label}
            >
              <span className="play-skill-glyph">{s.glyph}</span>
              {!ready && <div className="play-skill-cd" style={{ height: `${pct * 100}%` }} />}
              {!ready && <span className="play-skill-cd-num">{Math.ceil(remaining)}</span>}
              <span className="play-skill-bind">{s.bind}</span>
              <span className="play-skill-name">{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
