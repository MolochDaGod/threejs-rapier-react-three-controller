/**
 * Optional lab character strip — production entry is Ethereal Falls campfire
 * (`CampfireLobby` after Grudge ID). This UI must never feature Ikkaku/Madarame
 * or other removed lab cast; it only lists PLAYABLE_CHARACTERS.
 */
import { useMemo, useState, type CSSProperties } from "react";
import { PLAYABLE_CHARACTERS } from "../three/assets";
import { assetUrl } from "../three/assetHost";
import "./characterSelect.css";

const STORAGE_KEY = "grudge:selectedCharacter:v1";

/** Production stage order (no ikkaku / sensei / grudge6 grid). */
const FEATURED_IDS = [
  "explorer",
  "gunslinger",
  "archmage",
  "centurion",
] as const;

const BLOCKED_ID = /ikkau|ikkaku|madarame|karate-boss|sensei/i;

/** Poster art for the entry stage (PNG room/brand art — not GLB). */
function posterFor(id: string): string {
  if (id === "gunslinger") return assetUrl("emblem.png");
  if (id === "explorer" || id === "led-monk") return assetUrl("favicon.png");
  if (id === "archmage" || id === "soulbinder") return assetUrl("rooms/dressing-scene.png");
  if (id === "centurion" || id === "orc") return assetUrl("rooms/danger-scene.png");
  if (id === "sanji" || id === "tera-kasi") return assetUrl("rooms/voxgrudge-scene.png");
  return assetUrl("favicon.png");
}

export function loadStoredCharacterId(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (!v || BLOCKED_ID.test(v)) {
      if (v && BLOCKED_ID.test(v)) localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (PLAYABLE_CHARACTERS.some((c) => c.id === v)) return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveStoredCharacterId(id: string): void {
  if (BLOCKED_ID.test(id)) return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

interface Props {
  /** Called after the player confirms a character. */
  onSelect: (characterId: string) => void;
  /** Optional initial highlight. */
  initialId?: string;
}

export function CharacterSelect({ onSelect, initialId }: Props) {
  const roster = useMemo(() => {
    const fromFeatured = FEATURED_IDS.map((id) =>
      PLAYABLE_CHARACTERS.find((c) => c.id === id),
    ).filter((c): c is (typeof PLAYABLE_CHARACTERS)[number] => !!c);
    if (fromFeatured.length >= 2) return fromFeatured;
    return PLAYABLE_CHARACTERS.slice(0, 4);
  }, []);

  const safeInitial =
    initialId && !BLOCKED_ID.test(initialId) && roster.some((c) => c.id === initialId)
      ? initialId
      : null;

  const [active, setActive] = useState(
    () => safeInitial ?? loadStoredCharacterId() ?? roster[0]?.id ?? "explorer",
  );
  const selected = roster.find((c) => c.id === active) ?? roster[0];

  const confirm = () => {
    if (!selected) return;
    saveStoredCharacterId(selected.id);
    onSelect(selected.id);
  };

  if (!roster.length) {
    return (
      <div className="charselect">
        <p className="charselect-sub">No production characters available — use Ethereal Falls campfire.</p>
      </div>
    );
  }

  return (
    <div className="charselect">
      <div className="charselect-bg" aria-hidden />
      <header className="charselect-head">
        <p className="charselect-kicker">Grudge Studio</p>
        <h1 className="charselect-title">Production cast</h1>
        <p className="charselect-sub">
          Lab strip only — account heroes use Ethereal Falls campfire after sign-in.
        </p>
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
