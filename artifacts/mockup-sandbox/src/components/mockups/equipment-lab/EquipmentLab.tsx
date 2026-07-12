import { useMemo, useState } from "react";
import "./equipment.css";

/**
 * Self-contained preview of the Animator in-play Loadout overlay
 * (artifacts/animator/src/components/EquipmentScreen.tsx). Icons + weapon data
 * are stubbed here because mockups can't import from the animator artifact; the
 * markup + CSS mirror the real component so this verifies the visual design.
 */

type Group = "melee-1h" | "melee-2h" | "off-hand" | "ranged" | "magic" | "unarmed";

interface W {
  id: string;
  label: string;
  group: Group;
  animSet: string;
  glyph: string;
}

const WEAPONS: W[] = [
  { id: "fist", label: "Fists", group: "unarmed", animSet: "unarmed", glyph: "✊" },
  { id: "sword", label: "Long Sword", group: "melee-1h", animSet: "sword", glyph: "🗡️" },
  { id: "dagger", label: "Dagger", group: "melee-1h", animSet: "sword", glyph: "🔪" },
  { id: "mace", label: "War Mace", group: "melee-1h", animSet: "sword", glyph: "🔨" },
  { id: "axe", label: "Hand Axe", group: "melee-1h", animSet: "sword", glyph: "🪓" },
  { id: "greatsword", label: "Greatsword", group: "melee-2h", animSet: "greatsword", glyph: "⚔️" },
  { id: "spear", label: "War Spear", group: "melee-2h", animSet: "spear", glyph: "🔱" },
  { id: "scythe", label: "Scythe", group: "melee-2h", animSet: "greatsword", glyph: "🌾" },
  { id: "shield", label: "Tower Shield", group: "off-hand", animSet: "shield", glyph: "🛡️" },
  { id: "bow", label: "Recurve Bow", group: "ranged", animSet: "bow", glyph: "🏹" },
  { id: "pistol", label: "Flintlock", group: "ranged", animSet: "pistol", glyph: "🔫" },
  { id: "staff", label: "Arcane Staff", group: "magic", animSet: "magic", glyph: "🪄" },
  { id: "orb", label: "Spirit Orb", group: "magic", animSet: "magic", glyph: "🔮" },
];

const GROUP_ORDER: { id: Group; label: string }[] = [
  { id: "melee-1h", label: "One-Handed" },
  { id: "melee-2h", label: "Two-Handed" },
  { id: "off-hand", label: "Off-Hand" },
  { id: "ranged", label: "Ranged" },
  { id: "magic", label: "Magic" },
  { id: "unarmed", label: "Unarmed" },
];

const TEASER_SLOTS = ["Off-Hand", "Armor", "Trinket"] as const;

function Glyph({ glyph, size = 28 }: { glyph: string; size?: number }) {
  return (
    <span
      className="icon"
      style={{
        width: size,
        height: size,
        display: "inline-grid",
        placeItems: "center",
        fontSize: size * 0.6,
        borderRadius: 6,
        background: "rgba(0,0,0,0.3)",
      }}
    >
      {glyph}
    </span>
  );
}

export default function EquipmentLab() {
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState("sword");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUP_ORDER.map(({ id, label }) => ({
      id,
      label,
      items: WEAPONS.filter((w) => w.group === id && (!q || w.label.toLowerCase().includes(q))),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  const active = WEAPONS.find((w) => w.id === current);
  const totalShown = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="eq-screen" style={{ position: "relative", height: "100vh" }}>
      <div className="eq-backdrop" />
      <div className="eq-panel">
        <header className="eq-head">
          <div className="eq-title">
            <span className="eq-title-main">LOADOUT</span>
            <span className="eq-title-sub">Explorer</span>
          </div>
          <button className="eq-close" aria-label="Close">
            ✕
          </button>
        </header>

        <div className="eq-slots">
          <div className="eq-slot eq-slot-active">
            <span className="eq-slot-label">Main Hand</span>
            <div className="eq-slot-body">
              <Glyph glyph={active?.glyph ?? "✊"} size={30} />
              <div className="eq-slot-meta">
                <span className="eq-slot-name">{active?.label ?? "Unarmed"}</span>
                <span className="eq-slot-tag">{active?.animSet ?? "unarmed"}</span>
              </div>
            </div>
          </div>
          {TEASER_SLOTS.map((s) => (
            <div className="eq-slot eq-slot-locked" key={s} title="Modular slot — coming soon">
              <span className="eq-slot-label">{s}</span>
              <div className="eq-slot-body">
                <span className="eq-slot-empty">＋</span>
                <span className="eq-slot-soon">Soon</span>
              </div>
            </div>
          ))}
        </div>

        <div className="eq-search">
          <input
            type="text"
            placeholder="Search weapons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="eq-count">{totalShown}</span>
        </div>

        <div className="eq-grid-scroll">
          {groups.map((g) => (
            <section className="eq-group" key={g.id}>
              <h3 className="eq-group-head">
                {g.label} <span>{g.items.length}</span>
              </h3>
              <div className="eq-grid">
                {g.items.map((w) => {
                  const on = w.id === current;
                  return (
                    <button
                      key={w.id}
                      className={`eq-card ${on ? "on" : ""}`}
                      onClick={() => setCurrent(w.id)}
                      title={`${w.label} · ${w.animSet}`}
                    >
                      <Glyph glyph={w.glyph} />
                      <span className="eq-card-name">{w.label}</span>
                      {on && <span className="eq-card-badge">Equipped</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {groups.length === 0 && <p className="eq-empty">No weapons match “{query}”.</p>}
        </div>

        <footer className="eq-foot">
          <span>
            Click to equip live · <kbd>I</kbd> toggle · <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}
