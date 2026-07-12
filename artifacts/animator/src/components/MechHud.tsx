import type { CSSProperties } from "react";
import type { HudSnapshot } from "../three/types";
import { Icon } from "./Icon";
import type { HudEditApi, HudPanelBinding } from "../hud/useHudEditor";

interface Props {
  hud: HudSnapshot;
  /** Optional HUD-editor api: applies persisted layout and (when editing) drag/select. */
  edit?: HudEditApi;
}

/** Merge the editable "mech" panel binding onto its base className + inline style. */
function applyBind(b: HudPanelBinding | undefined, baseClass: string, baseStyle?: CSSProperties) {
  if (!b) return { className: baseClass, style: baseStyle };
  return {
    "data-hud-panel": b["data-hud-panel"],
    className: `${baseClass} ${b.className}`.trim(),
    style: { ...baseStyle, ...b.style },
    onPointerDown: b.onPointerDown,
    onContextMenu: b.onContextMenu,
  };
}

const clampPct = (v: number, max: number) => Math.max(0, Math.min(100, max > 0 ? (v / max) * 100 : 0));

/** A circular cockpit gauge with a radial cooldown sweep — the featured slam readout. */
function CockpitGauge({
  label,
  keyLabel,
  icon,
  cd,
  cdMax,
  hero,
}: {
  label: string;
  keyLabel: string;
  icon: string;
  cd: number;
  cdMax: number;
  hero?: boolean;
}) {
  const onCd = cd > 0 && cdMax > 0;
  const frac = onCd ? Math.max(0, Math.min(1, cd / cdMax)) : 0;
  // Sweep clears (charges up) as the cooldown counts down: ready = full ring.
  const charged = 1 - frac;
  const deg = charged * 360;
  return (
    <div className={`mc-gauge ${hero ? "mc-hero" : ""} ${onCd ? "mc-cooling" : "mc-ready"}`} title={label}>
      <div
        className="mc-gauge-ring"
        style={{
          background: `conic-gradient(var(--mc-fill) ${deg}deg, var(--mc-track) 0deg)`,
        }}
      >
        <div className="mc-gauge-core">
          <Icon name={icon} size={hero ? 26 : 18} />
          {onCd && <span className="mc-gauge-cd">{cd.toFixed(1)}</span>}
        </div>
      </div>
      <span className="mc-gauge-key">{keyLabel}</span>
      <span className="mc-gauge-label">{label}</span>
    </div>
  );
}

/**
 * Cockpit / heads-up overlay shown ONLY while the player is sealed inside the
 * exo-armour mech. It mounts on the piloted edge (rendered conditionally in App)
 * so the boot-up flourish plays once at the seal-shut moment, and unmounts on
 * release. Reads as a machine interior — distinct from the on-foot fighter HUD —
 * and surfaces the mech slam (Seismic Stomp) cooldown plus armour integrity.
 *
 * It respects the HUD editor: the readout console binds to the `mech` panel id
 * (movable / scalable / hideable, persisted), and themed styling is class-gated
 * under `.studio.hud-themed` so the default cockpit look is untouched.
 */
export function MechHud({ hud, edit }: Props) {
  const mech = hud.mech;
  if (!mech) return null;

  // The slam is the mech's signature ground-pound (first ability); the rest are
  // shown as secondary cockpit gauges.
  const [slam, ...others] = mech.abilities;
  const integrity = clampPct(hud.health, hud.maxHealth);
  const integLow = integrity <= 30;
  // Critically low: drive the red-alert canopy pulse + klaxon warning banner.
  const integCrit = integrity <= 25;
  // Brief per-hit impact flash, mirroring the on-foot fighter's hurt vignette.
  const hitOpacity = hud.hurt > 0 ? Math.min(1, hud.hurt / 0.4) : 0;

  return (
    <div className="mech-cockpit" aria-hidden>
      {/* Canopy frame: corner brackets + interior tint that read as a machine shell. */}
      <div className="mc-canopy">
        <span className="mc-corner mc-tl" />
        <span className="mc-corner mc-tr" />
        <span className="mc-corner mc-bl" />
        <span className="mc-corner mc-br" />
        <div className="mc-scanline" />
      </div>

      {/* Damage impact flash — fires for the brief window after the mech takes a
          hit (mirrors the fighter's hurt-vignette, cockpit-tinted). */}
      {hitOpacity > 0 && <div className="mc-hitflash" style={{ opacity: hitOpacity }} />}

      {/* Critical red-alert: pulsing red canopy vignette + flashing klaxon banner
          while armour integrity is critically low. */}
      {integCrit && (
        <>
          <div className="mc-redalert" />
          <div className="mc-klaxon">
            <span className="mc-klaxon-icon">⚠</span>
            <span>ARMOUR CRITICAL</span>
            <span className="mc-klaxon-icon">⚠</span>
          </div>
        </>
      )}

      {/* Top status strip — the boot-up flourish "SYSTEMS ONLINE" plays here. */}
      <div className="mc-topstrip">
        <span className="mc-tag">EXO-ARMOUR</span>
        <span className="mc-divider" />
        <span className="mc-mode">PILOTED</span>
        <span className="mc-boot">▣ SYSTEMS ONLINE</span>
      </div>

      {/* Reticle reframe — a mech targeting bracket around screen center. */}
      <div className="mc-reticle">
        <span className="mc-bracket mc-b-tl" />
        <span className="mc-bracket mc-b-tr" />
        <span className="mc-bracket mc-b-bl" />
        <span className="mc-bracket mc-b-br" />
        <span className="mc-aimdot" />
      </div>

      {/* Cockpit console (editable): armour integrity + slam-cooldown gauge cluster. */}
      <div {...applyBind(edit?.bind("mech"), "mc-console")}>
        <div className="mc-integrity">
          <div className="mc-integrity-head">
            <span>ARMOUR INTEGRITY</span>
            <span className={`mc-integrity-num ${integLow ? "mc-crit" : ""}`}>
              {Math.round(integrity)}%
            </span>
          </div>
          <div className="mc-integrity-track">
            <div
              className={`mc-integrity-fill ${integLow ? "mc-crit" : ""}`}
              style={{ width: `${integrity}%` }}
            />
          </div>
        </div>
        <div className="mc-gauges">
          {slam && (
            <CockpitGauge
              label={slam.name}
              keyLabel={slam.key}
              icon={slam.icon}
              cd={slam.cd}
              cdMax={slam.cdMax}
              hero
            />
          )}
          {others.map((a) => (
            <CockpitGauge
              key={a.key}
              label={a.name}
              keyLabel={a.key}
              icon={a.icon}
              cd={a.cd}
              cdMax={a.cdMax}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
