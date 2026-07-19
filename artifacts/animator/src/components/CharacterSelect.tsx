/**
 * First-run character select — four featured fighters on a stage.
 * Choosing one advances to the existing landing page (Grudge ID).
 */
import { useMemo, useState, type CSSProperties } from "react";
import { CHARACTERS } from "../three/assets";
import { assetUrl } from "../three/assetHost";
import "./characterSelect.css";

const STORAGE_KEY = "grudge:selectedCharacter:v1";

/** Featured roster for the entry scene (order = stage left → right). */
const FEATURED_IDS = ["ikkaku-madarame", "ikkaku-crimson", "ikkaku-azure", "ikkaku-void"] as const;

/** Poster art for the entry stage (PNG room/brand art — not GLB). */
function posterFor(id: string): string {
  if (id === "ikkaku-madarame") return assetUrl("favicon.png");
  if (id === "ikkaku-crimson") return assetUrl("rooms/danger-scene.png");
  if (id === "ikkaku-azure") return assetUrl("rooms/dressing-scene.png");
  if (id === "ikkaku-void") return assetUrl("rooms/voxgrudge-scene.png");
  if (id === "gunslinger") return assetUrl("emblem.png");
  if (id === "explorer") return assetUrl("favicon.png");
  if (id === "karate-boss") return assetUrl("rooms/danger-scene.png");
  if (id === "orc") return assetUrl("rooms/dressing-scene.png");
  return assetUrl("favicon.png");
}

export function loadStoredCharacterId(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && CHARACTERS.some((c) => c.id === v)) return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveStoredCharacterId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

interface Props {
  /** Called after the player confirms a character (goes to landing). */
  onSelect: (characterId: string) => void;
  /** Optional initial highlight. */
  initialId?: string;
}

export function CharacterSelect({ onSelect, initialId }: Props) {
  const roster = useMemo(
    () =>
      FEATURED_IDS.map((id) => CHARACTERS.find((c) => c.id === id)).filter(
        (c): c is (typeof CHARACTERS)[number] => !!c,
      ),
    [],
  );
  const [active, setActive] = useState(
    () => initialId ?? loadStoredCharacterId() ?? roster[0]?.id ?? "explorer",
  );
  const selected = roster.find((c) => c.id === active) ?? roster[0];

  const confirm = () => {
    if (!selected) return;
    saveStoredCharacterId(selected.id);
    onSelect(selected.id);
  };

  return (
    <div className="charselect">
      <div className="charselect-bg" aria-hidden />
      <header className="charselect-head">
        <p className="charselect-kicker">Grudge Studio</p>
        <h1 className="charselect-title">Choose your fighter</h1>
        <p className="charselect-sub">Four heroes. One path into the facility.</p>
      </header>

      <div className="charselect-stage" role="listbox" aria-label="Characters">
        {roster.map((c, i) => {
          const on = c.id === active;
          return (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={on}
              className={`charselect-card ${on ? "active" : ""}`}
              style={{ "--i": i } as CSSProperties}
              onClick={() => setActive(c.id)}
              onDoubleClick={confirm}
            >
              <div className="charselect-frame">
                <img
                  className="charselect-art"
                  src={posterFor(c.id)}
                  alt=""
                  draggable={false}
                />
                <div className="charselect-glow" />
              </div>
              <div className="charselect-meta">
                <span className="charselect-name">{c.name}</span>
                <span className="charselect-id">{c.id}</span>
              </div>
            </button>
          );
        })}
      </div>

      <footer className="charselect-foot">
        {selected && (
          <div className="charselect-preview">
            <strong>{selected.name}</strong>
            <span>
              {selected.signatureSkills?.length
                ? selected.signatureSkills
                    .slice(0, 3)
                    .map((s) => s.label)
                    .join(" · ")
                : "Ready for combat"}
            </span>
          </div>
        )}
        <button
          type="button"
          className="charselect-confirm"
          onClick={confirm}
          disabled={!selected}
        >
          Continue with {selected?.name ?? "hero"}
        </button>
      </footer>
    </div>
  );
}
