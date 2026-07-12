import { useState } from "react";
import { STATUS_MENU } from "../three/fx/StatusFx";
import type { StatusId } from "../three/types";

/**
 * Tap-to-apply dock: a button per status that triggers its aura + notifier.
 * Buffs and debuffs are grouped; each button shows the status glyph in its own
 * color. Demo surface for the status FX layer (no gameplay coupling).
 *
 * The Buffs group has an "Area" toggle: when on, a buff splashes onto every
 * ally within range (each wears its own aura) instead of the single selected ally.
 */
export function StatusDock({ onApply }: { onApply: (id: StatusId, aoe?: boolean) => void }) {
  const [area, setArea] = useState(false);
  const debuffs = STATUS_MENU.filter((s) => s.kind === "debuff");
  const buffs = STATUS_MENU.filter((s) => s.kind === "buff");
  return (
    <div className="status-dock">
      <div className="status-dock-group">
        <span className="status-dock-label">Debuffs</span>
        <div className="status-dock-row">
          {debuffs.map((s) => (
            <button
              key={s.id}
              className="status-dock-btn debuff"
              title={s.name}
              onPointerDown={(e) => {
                e.preventDefault();
                onApply(s.id);
              }}
            >
              <span style={{ color: s.color }}>{s.glyph}</span>
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <div className="status-dock-group">
        <span className="status-dock-label">
          Buffs
          <button
            className={`status-dock-toggle${area ? " on" : ""}`}
            title="Apply buffs to all allies within range"
            onPointerDown={(e) => {
              e.preventDefault();
              setArea((v) => !v);
            }}
          >
            Area {area ? "On" : "Off"}
          </button>
        </span>
        <div className="status-dock-row">
          {buffs.map((s) => (
            <button
              key={s.id}
              className="status-dock-btn buff"
              title={s.name}
              onPointerDown={(e) => {
                e.preventDefault();
                onApply(s.id, area);
              }}
            >
              <span style={{ color: s.color }}>{s.glyph}</span>
              {s.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
