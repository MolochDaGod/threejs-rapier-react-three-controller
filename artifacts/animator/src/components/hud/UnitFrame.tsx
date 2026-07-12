// Fantasy unit-status frames (player + locked target) styled after the ornate
// gold reference art: circular portrait ring, angled gold-framed plates for the
// name / HP / energy, and fully animated bars (tweened drain, delayed damage
// ghost, damage flash, heal shimmer) driven by the pure vitalAnim stepper.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  createVitalAnim,
  DAMAGE_FLASH_S,
  retargetVitalAnim,
  stepVitalAnim,
  vitalAnimSettled,
  type VitalAnim,
} from "../../hud/vitalAnim";
import "./unitFrame.css";

/**
 * Animate a live vital value with a rAF loop that only runs while a tween is
 * in flight. The pure stepper owns all the feel (drain speed, ghost hold, etc).
 */
function useVitalAnim(value: number, max: number): VitalAnim {
  const [anim, setAnim] = useState<VitalAnim>(() => createVitalAnim(value, max));
  const stateRef = useRef(anim);
  useEffect(() => {
    stateRef.current = retargetVitalAnim(stateRef.current, value, max);
    setAnim(stateRef.current);
    if (vitalAnimSettled(stateRef.current)) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      stateRef.current = stepVitalAnim(stateRef.current, dt);
      setAnim(stateRef.current);
      if (!vitalAnimSettled(stateRef.current)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, max]);
  return anim;
}

const pctOf = (v: number, max: number) =>
  max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;

/** One angled gold-framed bar: ghost + fill + flash + centered numbers. */
function UnitBar({
  kind,
  anim,
  value,
  max,
}: {
  kind: "hp-friendly" | "hp-hostile" | "energy";
  anim: VitalAnim;
  value: number;
  max: number;
}) {
  const flash = anim.flashT > 0;
  return (
    <div className={`uf-plate uf-bar uf-bar-${kind}`}>
      <div className="uf-plate-inner">
        <div className="uf-ghost" style={{ width: `${pctOf(anim.ghost, anim.max)}%` }} />
        <div
          className={`uf-fill ${anim.healT > 0 ? "uf-healing" : ""}`}
          style={{ width: `${pctOf(anim.fill, anim.max)}%` }}
        />
        {flash && (
          <div
            className="uf-flash"
            style={{
              width: `${pctOf(anim.ghost, anim.max)}%`,
              opacity: Math.min(1, anim.flashT / DAMAGE_FLASH_S),
            }}
          />
        )}
        <span className="uf-num">
          {Math.round(value)} / {Math.round(max)}
        </span>
      </div>
    </div>
  );
}

export interface UnitFrameProps {
  /** Portrait on the left (player) or mirrored on the right (target). */
  side: "left" | "right";
  /** Drives the HP fill palette (green friendly / red hostile). */
  variant: "player" | "target";
  name: string;
  /** Small dimmed line under the name (weapon label / relationship). */
  sub?: string;
  /** Content inside the circular portrait ring. */
  portrait: ReactNode;
  /** Content of the small round badge at the portrait's lower-outer edge. */
  badge?: ReactNode;
  hp: { value: number; max: number };
  energy: { value: number; max: number };
}

export function UnitFrame({ side, variant, name, sub, portrait, badge, hp, energy }: UnitFrameProps) {
  const hpAnim = useVitalAnim(hp.value, hp.max);
  const energyAnim = useVitalAnim(energy.value, energy.max);
  const hurt = hpAnim.flashT > 0;
  return (
    <div className={`uf uf-${variant} ${side === "right" ? "uf-flip" : ""} ${hurt ? "uf-hurt" : ""}`}>
      <div className="uf-portrait">
        <div className="uf-ring">
          <div className="uf-ring-inner">{portrait}</div>
        </div>
        <span className="uf-spike uf-spike-top" />
        <span className="uf-spike uf-spike-bottom" />
        {badge && <div className="uf-badge">{badge}</div>}
      </div>
      <div className="uf-plates">
        <div className="uf-plate uf-nameplate">
          <div className="uf-plate-inner uf-name-inner">
            <span className="uf-name">{name}</span>
            {sub && <span className="uf-sub">{sub}</span>}
          </div>
        </div>
        <UnitBar
          kind={variant === "player" ? "hp-friendly" : "hp-hostile"}
          anim={hpAnim}
          value={hp.value}
          max={hp.max}
        />
        <UnitBar kind="energy" anim={energyAnim} value={energy.value} max={energy.max} />
      </div>
      {hurt && (
        <div
          className="uf-hurt-glow"
          style={{ opacity: Math.min(1, hpAnim.flashT / DAMAGE_FLASH_S) * 0.9 }}
        />
      )}
    </div>
  );
}
