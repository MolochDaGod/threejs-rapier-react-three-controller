import { MAP_TEMPLATES, type MapTemplate } from "../three/voxel/templates";

interface Props {
  /** Load a starting template into the editor. */
  onPick: (template: MapTemplate) => void;
  /** Start from an empty pad. */
  onBlank: () => void;
  /** Dismiss without changing the current map. */
  onClose: () => void;
}

/**
 * Starting-map chooser shown on entering the Voxel Editor (and via "New Map").
 * Picking a template loads a ready-made layout; "Blank Canvas" starts empty.
 */
export function VoxelTemplatePicker({ onPick, onBlank, onClose }: Props) {
  return (
    <div className="ve-tpl-overlay" role="dialog" aria-label="Choose a starting map">
      <div className="ve-tpl-modal">
        <div className="ve-tpl-head">
          <h3>Choose a starting map</h3>
          <button className="ve-tpl-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ve-tpl-grid">
          {MAP_TEMPLATES.map((t) => (
            <button key={t.id} className="ve-tpl-card" onClick={() => onPick(t)}>
              <span className="ve-tpl-name">{t.label}</span>
              <span className="ve-tpl-desc">{t.desc}</span>
            </button>
          ))}
          <button className="ve-tpl-card ve-tpl-blank" onClick={onBlank}>
            <span className="ve-tpl-name">Blank Canvas</span>
            <span className="ve-tpl-desc">Start from an empty pad</span>
          </button>
        </div>
      </div>
    </div>
  );
}
