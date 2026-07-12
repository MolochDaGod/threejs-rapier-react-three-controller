import type { StatusView } from "../three/types";

/** Optional HUD-editor binding (layout vars + drag/select when editing). */
interface StatusEditBind {
  "data-hud-panel": string;
  className: string;
  style: React.CSSProperties;
  onPointerDown?: (e: React.PointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/**
 * Buff/debuff notifier: one chip per active status with its glyph, name and a
 * draining timer bar. Buffs read green-tinted, debuffs red-tinted; the chip's
 * accent uses the status' own color. Pure overlay driven by HUD snapshots.
 */
export function StatusBar({ statuses, editBind }: { statuses: StatusView[]; editBind?: StatusEditBind }) {
  // When editing, render an empty (but selectable) panel so it can be arranged
  // even with no active statuses; otherwise stay hidden until something procs.
  const editing = !!editBind && editBind.className.includes("hud-editable");
  if (!statuses.length && !editing) return null;
  return (
    <div
      data-hud-panel={editBind?.["data-hud-panel"]}
      className={`status-bar${editBind ? ` ${editBind.className}` : ""}`}
      style={editBind?.style}
      onPointerDown={editBind?.onPointerDown}
      onContextMenu={editBind?.onContextMenu}
    >
      {editing && !statuses.length && <div className="status-empty">Status notifier</div>}
      {statuses.map((s) => {
        const pct = s.duration > 0 ? Math.max(0, Math.min(1, s.remaining / s.duration)) : 0;
        return (
          <div
            key={s.id}
            className={`status-chip status-${s.kind}`}
            style={{ ["--status-color" as string]: s.color }}
          >
            <span className="status-glyph" style={{ color: s.color }}>
              {s.glyph}
            </span>
            <div className="status-meta">
              <div className="status-row">
                <span className="status-name">{s.name}</span>
                <span className="status-time">{Math.ceil(s.remaining)}s</span>
              </div>
              <div className="status-track">
                <div className="status-fill" style={{ width: `${pct * 100}%`, background: s.color }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
