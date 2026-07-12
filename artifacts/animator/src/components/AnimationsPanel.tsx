import type { ActionSlot, SlotBinding } from "../three/types";
import { categorizeClips } from "../three/ExplorerCharacter";
import { Icon } from "./Icon";

interface Props {
  open: boolean;
  clips: string[];
  slots: SlotBinding[];
  currentClip: string;
  onPreview: (clip: string) => void;
  onAssign: (slot: ActionSlot, clip: string | null) => void;
  onClose: () => void;
  /** When false, render only the section bodies (hosted inside the dock shell). */
  chrome?: boolean;
}

export function AnimationsPanel({ open, clips, slots, currentClip, onPreview, onAssign, onClose, chrome = true }: Props) {
  if (chrome && !open) return null;
  const body = (
    <>
      <div className="panel-section">
        <h3>
          <Icon name="anim-test" size={16} /> Clips ({clips.length})
        </h3>
        {clips.length === 0 && <p className="panel-hint">No clips found in this character.</p>}
        {categorizeClips(clips).map((group) => (
          <div key={group.label} className="clip-group">
            <h4 className="clip-group-label">{group.label}</h4>
            <div className="clip-list">
              {group.clips.map((c) => (
                <div key={c} className={`clip-row ${c === currentClip ? "playing" : ""}`}>
                  <span className="clip-name" title={c}>
                    {c}
                  </span>
                  <button className="clip-play" onClick={() => onPreview(c)} title="Preview clip">
                    ▶
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="skill-slot" size={16} /> Action Slots
        </h3>
        {slots.map((s) => (
          <div key={s.slot} className="slot-assign">
            <div className="slot-assign-head">
              <span className="slot-key">{s.key}</span>
              <span className="slot-assign-label">{s.label}</span>
              {s.custom && (
                <button
                  className="slot-reset"
                  onClick={() => onAssign(s.slot, null)}
                  title="Reset to default"
                >
                  reset
                </button>
              )}
            </div>
            <select
              className="slot-select"
              value={s.custom ? s.clip : ""}
              onChange={(e) => onAssign(s.slot, e.target.value || null)}
            >
              <option value="">{s.clip ? `Default (${s.clip})` : "Default (none)"}</option>
              {clips.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </>
  );

  if (!chrome) return body;
  return (
    <div className="panel panel-right">
      <div className="panel-head">
        <h2>
          <Icon name="clip-library" size={20} className="head-icon" /> Animations
        </h2>
        <button className="x" onClick={onClose}>
          ✕
        </button>
      </div>
      {body}
      <p className="panel-hint">
        Press <kbd>C</kbd> to toggle this panel. Changes save per character.
      </p>
    </div>
  );
}
