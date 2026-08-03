/**
 * Conan / survival product surface — tool wheel + kenney blueprint browser.
 * Wired to Studio activityMode / CampLab / Open harvestTools.
 */
import type { HudSnapshot } from "../three/types";
import "./survivalHud.css";

type Survival = NonNullable<HudSnapshot["survival"]>;

interface Props {
  survival: Survival;
  onSelectBlueprint?: (id: string) => void;
  onSelectTool?: (index: number) => void;
  onCraftTool?: (id: string) => void;
}

export function SurvivalHud({
  survival,
  onSelectBlueprint,
  onSelectTool,
  onCraftTool,
}: Props) {
  const w = survival.wallet;
  return (
    <div className="surv-root" aria-label="Survival lab">
      {/* Wallet strip always visible in survival surfaces */}
      <div className="surv-wallet" data-tip="Lab resources (harvest → camp craft)">
        <span className="surv-mode">{survival.activityMode.toUpperCase()}</span>
        <span>W {w.wood}</span>
        <span>S {w.stone}</span>
        <span>F {w.fiber}</span>
        <span>O {w.ore}</span>
        <span className="surv-tool">tool:{survival.activityTool}</span>
      </div>

      {survival.toolWheelOpen && (
        <div className="surv-wheel">
          <div className="surv-wheel-title">Harvest tools · U close · 1–4</div>
          <div className="surv-wheel-grid">
            {survival.tools.map((t, i) => (
              <button
                key={t.id}
                type="button"
                className={`surv-tool-btn ${t.active ? "active" : ""} ${t.crafted ? "crafted" : "uncrafted"}`}
                onClick={() => (t.crafted ? onSelectTool?.(i) : onCraftTool?.(t.id))}
                title={t.crafted ? `Equip ${t.name}` : `Craft ${t.name}`}
              >
                <img src={t.icon} alt="" className="surv-tool-icon" draggable={false} />
                <span className="surv-tool-key">{i + 1}</span>
                <span className="surv-tool-name">{t.name}</span>
                <span className="surv-tool-state">{t.crafted ? (t.active ? "ON" : "OK") : "CRAFT"}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {survival.buildMode && survival.blueprintOpen && (
        <div className="surv-blueprints">
          <div className="surv-bp-title">Kenney blueprints · B off · Y cycle · LMB place</div>
          <div className="surv-bp-grid">
            {survival.buildPieces.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`surv-bp-btn ${survival.buildSelectedId === p.id ? "active" : ""}`}
                onClick={() => onSelectBlueprint?.(p.id)}
                title={`${p.label} · wood ${p.wood} · stone ${p.stone}`}
              >
                <span className="surv-bp-cat">{p.category}</span>
                <span className="surv-bp-label">{p.label}</span>
                <span className="surv-bp-cost">
                  W{p.wood} S{p.stone}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
