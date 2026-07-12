import { useState } from "react";
import type { StoredMapMeta } from "../three/voxel/mapStore";

interface Props {
  maps: StoredMapMeta[];
  currentId: string | null;
  name: string;
  onName: (name: string) => void;
  onSave: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  /** Returns the current map serialized as shareable JSON. */
  onExport: () => string;
  /** Loads a pasted JSON map. Returns false if the text isn't a valid map. */
  onImport: (json: string) => boolean;
  onClose: () => void;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function VoxelMapsPanel({
  maps,
  currentId,
  name,
  onName,
  onSave,
  onLoad,
  onDelete,
  onExport,
  onImport,
  onClose,
}: Props) {
  const [share, setShare] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote((n) => (n === msg ? null : n)), 2200);
  };

  const openExport = () => {
    setText(onExport());
    setShare(true);
    setNote(null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      flash("Copied to clipboard");
    } catch {
      flash("Select the text and copy manually");
    }
  };

  const doImport = () => {
    if (onImport(text)) {
      flash("Map imported");
      setShare(false);
      setText("");
    } else {
      flash("That isn't a valid map JSON");
    }
  };

  return (
    <div className="ve-maps">
      <div className="ve-maps-head">
        <h3>Maps</h3>
        <button className="ve-btn" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="ve-maps-save">
        <input
          className="ve-input"
          type="text"
          value={name}
          placeholder="Map name"
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
          }}
        />
        <button className="ve-btn" onClick={onSave}>
          {currentId && maps.some((m) => m.id === currentId) ? "Save" : "Save New"}
        </button>
      </div>

      <div className="ve-maps-list">
        {maps.length === 0 ? (
          <p className="ve-maps-empty">No saved maps yet. Name one above and Save.</p>
        ) : (
          maps.map((m) => (
            <div key={m.id} className={`ve-maps-row ${m.id === currentId ? "current" : ""}`}>
              <div className="ve-maps-meta">
                <span className="ve-maps-name">{m.name}</span>
                <span className="ve-maps-time">{timeAgo(m.updatedAt)}</span>
              </div>
              <div className="ve-maps-row-actions">
                <button className="ve-btn ve-btn-sm" onClick={() => onLoad(m.id)}>
                  Load
                </button>
                <button
                  className="ve-btn ve-btn-sm ve-danger"
                  onClick={() => onDelete(m.id)}
                  aria-label={`Delete ${m.name}`}
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="ve-maps-share">
        {!share ? (
          <div className="ve-maps-share-actions">
            <button className="ve-btn" onClick={openExport}>
              Export JSON
            </button>
            <button
              className="ve-btn"
              onClick={() => {
                setShare(true);
                setText("");
                setNote(null);
              }}
            >
              Import JSON
            </button>
          </div>
        ) : (
          <>
            <textarea
              className="ve-textarea"
              value={text}
              placeholder="Paste a map's JSON here to import…"
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
            <div className="ve-maps-share-actions">
              <button className="ve-btn" onClick={copy}>
                Copy
              </button>
              <button className="ve-btn" onClick={doImport}>
                Import
              </button>
              <button
                className="ve-btn"
                onClick={() => {
                  setShare(false);
                  setText("");
                }}
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>

      {note && <div className="ve-maps-note">{note}</div>}
    </div>
  );
}
