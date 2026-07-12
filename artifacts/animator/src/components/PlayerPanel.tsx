/**
 * Pop-out character panel in the Grudge Warlords "main panel" style —
 * gold-on-dark-brown, display serif headers, mono values, stat-row k/v
 * lists and a tab strip. Opens from the PlayerBadge on the landing page.
 */
import { useEffect, useRef, useState } from "react";
import { raceDef, skinToneOf, type AvatarConfig } from "../three/avatar/catalog";
import { cssHex } from "../three/avatar/pixels";
import { formatGbux } from "../lib/gbux";

interface Props {
  name: string;
  isSignedIn: boolean;
  cfg: AvatarConfig;
  /** False when showing the default head because no avatar was saved yet. */
  hasSavedHead: boolean;
  portrait: string | null;
  gbux: number;
  onClose: () => void;
  onEditAvatar: () => void;
}

type Tab = "character" | "appearance";

/** "topknot" → "Topknot", "none" → "None". */
function labelize(id: string): string {
  return id.length ? id[0].toUpperCase() + id.slice(1) : id;
}

function StatRow({ k, v, accent }: { k: string; v: React.ReactNode; accent?: boolean }) {
  return (
    <div className="gw-stat-row">
      <span className="gw-k">{k}</span>
      <span className={accent ? "gw-v gw-v-gold" : "gw-v"}>{v}</span>
    </div>
  );
}

export function PlayerPanel({
  name,
  isSignedIn,
  cfg,
  hasSavedHead,
  portrait,
  gbux,
  onClose,
  onEditAvatar,
}: Props) {
  const [tab, setTab] = useState<Tab>("character");
  const race = raceDef(cfg.race);
  const skinHex = cssHex(skinToneOf(cfg));
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the dialog on open; hand it back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="gw-overlay" onClick={onClose}>
      <div
        className="gw-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Character panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gw-topbar">
          <h1 className="gw-logo">Character</h1>
          <div className="gw-player-info">
            <span className="gw-name">{name}</span>
            <span className="gw-class">Lv.1 {race.label}</span>
            <div className="gw-xp-bar" aria-label="XP">
              <div className="gw-xp-fill" style={{ width: "8%" }} />
            </div>
          </div>
          <button
            ref={closeRef}
            className="gw-close"
            onClick={onClose}
            aria-label="Close character panel"
          >
            ✕
          </button>
        </header>

        <div className="gw-body">
          <div className="gw-left">
            <div className="gw-portrait-frame">
              {portrait ? (
                <img src={portrait} alt={`${name}'s avatar`} draggable={false} />
              ) : (
                <span className="gw-portrait-empty">?</span>
              )}
            </div>
            <div className="gw-race-name">{race.label}</div>
            <div className="gw-race-blurb">{race.blurb}</div>
            <div className="gw-gbux-card">
              <span className="gw-gbux-label">GBUX</span>
              <span className="gw-gbux-val">{formatGbux(gbux)}</span>
            </div>
            <button className="gw-btn" onClick={onEditAvatar}>
              {hasSavedHead ? "Edit in Avatar Edit" : "Create in Avatar Edit"}
            </button>
          </div>

          <div className="gw-right">
            <nav className="gw-tabs">
              <button
                className={tab === "character" ? "gw-tab gw-tab-active" : "gw-tab"}
                onClick={() => setTab("character")}
              >
                Character
              </button>
              <button
                className={tab === "appearance" ? "gw-tab gw-tab-active" : "gw-tab"}
                onClick={() => setTab("appearance")}
              >
                Appearance
              </button>
            </nav>

            {!hasSavedHead && (
              <div className="gw-banner">
                No saved avatar yet — showing the default {race.label}. Build yours in Avatar
                Edit and hit “Save to Character”.
              </div>
            )}

            {tab === "character" ? (
              <div className="gw-rows">
                <StatRow k="Name" v={name} accent />
                <StatRow k="Account" v={isSignedIn ? "Signed in" : "Guest"} />
                <StatRow k="Race" v={race.label} />
                <StatRow k="Level" v="1" />
                <StatRow k="XP" v="8 / 100" />
                <StatRow k="GBUX" v={formatGbux(gbux)} accent />
              </div>
            ) : (
              <div className="gw-rows">
                <StatRow
                  k="Skin"
                  v={
                    <span className="gw-swatch-wrap">
                      <span className="gw-swatch" style={{ background: skinHex }} />
                      {skinHex}
                    </span>
                  }
                />
                <StatRow k="Hair" v={labelize(cfg.hair)} />
                <StatRow k="Eyes" v={labelize(cfg.eyes)} />
                <StatRow k="Brows" v={labelize(cfg.brows)} />
                <StatRow k="Mouth" v={labelize(cfg.mouth)} />
                <StatRow k="Facial hair" v={labelize(cfg.facialHair)} />
                <StatRow k="Ears" v={labelize(cfg.ears)} />
                <StatRow k="Tusks" v={labelize(cfg.tusks)} />
                <StatRow k="Headgear" v={labelize(cfg.headgear)} />
                <StatRow k="Hat" v={labelize(cfg.hat)} />
                <StatRow k="Expression" v={labelize(cfg.expression)} />
                <StatRow k="Extra" v={labelize(cfg.extra)} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
