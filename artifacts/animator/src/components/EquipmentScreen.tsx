import { useMemo, useState } from "react";
import type { WeaponGroup, WeaponId } from "../three/types";
import { WEAPONS, OFF_HAND_WEAPONS, offHandEligible } from "../three/arsenal";
import { WEAPON_ICON } from "../three/icons";
import {
  ARMOR_SETS,
  ARMOR_SLOTS,
  emptyArmorLoadout,
  getArmorPiece,
  getArmorSet,
  loadoutDefense,
  loadoutFromSet,
  type ArmorLoadout,
  type ArmorSlot,
} from "../three/equipment";
import { Icon } from "./Icon";
import "./EquipmentScreen.css";

interface Props {
  /** Display name of the character whose loadout we're editing. */
  characterName: string;
  /** Currently equipped weapon id (drives the highlighted card + Main Hand slot). */
  currentWeapon: WeaponId;
  /** Currently equipped off-hand piece id, or null when the off hand is empty. */
  currentOffHand: WeaponId | null;
  /** Minecraft-style four-slot armor loadout. */
  armorLoadout: ArmorLoadout;
  /** Equip a weapon live (mirrors the real combat equip path via studio.setWeapon). */
  onEquip: (id: WeaponId) => void;
  /** Equip / clear the independent off-hand piece (studio.setOffHand). */
  onEquipOff: (id: WeaponId | null) => void;
  /** Replace the full armor loadout (set equip or clear). */
  onArmorLoadout: (loadout: ArmorLoadout) => void;
  /** Close the overlay. */
  onClose: () => void;
}

/**
 * Display order + headings for the weapon families surfaced in the loadout grid.
 * The off-hand family is intentionally NOT here — off-hand pieces live in their
 * own slot picker (they mount alongside a main weapon, not as a main weapon).
 */
const GROUP_ORDER: { id: WeaponGroup; label: string }[] = [
  { id: "melee-1h", label: "One-Handed" },
  { id: "melee-2h", label: "Two-Handed" },
  { id: "ranged", label: "Ranged" },
  { id: "magic", label: "Magic" },
  { id: "unarmed", label: "Unarmed" },
];

const SLOT_LABEL: Record<ArmorSlot, string> = {
  head: "Head",
  chest: "Chest",
  legs: "Legs",
  feet: "Feet",
};

type Tab = "weapons" | "armor";

/**
 * In-play loadout overlay — weapons (live combat equip) + Minecraft-style armor
 * slots (head/chest/legs/feet) backed by the realistic armor stand catalog.
 */
export function EquipmentScreen({
  characterName,
  currentWeapon,
  currentOffHand,
  armorLoadout,
  onEquip,
  onEquipOff,
  onArmorLoadout,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("weapons");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUP_ORDER.map(({ id, label }) => ({
      id,
      label,
      items: WEAPONS.filter(
        (w) => (w.group ?? "unarmed") === id && (!q || w.label.toLowerCase().includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  const armorSets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ARMOR_SETS.filter(
      (s) =>
        !q ||
        s.label.toLowerCase().includes(q) ||
        s.material.includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [query]);

  const active = WEAPONS.find((w) => w.id === currentWeapon);
  const activeOff = currentOffHand ? WEAPONS.find((w) => w.id === currentOffHand) : null;
  const offEligible = offHandEligible(currentWeapon);
  const totalShown =
    tab === "weapons"
      ? groups.reduce((n, g) => n + g.items.length, 0)
      : armorSets.length;
  const defense = loadoutDefense(armorLoadout);

  const activeSetId = ARMOR_SETS.find((set) =>
    ARMOR_SLOTS.every((slot) => armorLoadout[slot] === set.pieces[slot]),
  )?.id;

  return (
    <div className="eq-screen" role="dialog" aria-label="Equipment loadout">
      <button className="eq-backdrop" aria-label="Close loadout" onClick={onClose} />

      <div className="eq-panel" onClick={(e) => e.stopPropagation()}>
        <header className="eq-head">
          <div className="eq-title">
            <span className="eq-title-main">LOADOUT</span>
            <span className="eq-title-sub">{characterName}</span>
          </div>
          <button className="eq-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {/* Minecraft-style strip: weapons hands + four armor slots */}
        <div className="eq-slots">
          <div className="eq-slot eq-slot-active">
            <span className="eq-slot-label">Main Hand</span>
            <div className="eq-slot-body">
              <Icon name={WEAPON_ICON[currentWeapon]} size={30} className="eq-slot-icon" />
              <div className="eq-slot-meta">
                <span className="eq-slot-name">{active?.label ?? "Unarmed"}</span>
                <span className="eq-slot-tag">{active?.animSet ?? "unarmed"}</span>
              </div>
            </div>
          </div>

          <div
            className={`eq-slot ${activeOff ? "eq-slot-active" : ""} ${offEligible ? "" : "eq-slot-disabled"}`}
            data-tip={offEligible ? "Off-hand piece" : "Off-hand unavailable while dual-wielding / two-handed"}
          >
            <span className="eq-slot-label">Off-Hand</span>
            <div className="eq-slot-body">
              {activeOff ? (
                <>
                  <Icon name={WEAPON_ICON[activeOff.id]} size={30} className="eq-slot-icon" />
                  <div className="eq-slot-meta">
                    <span className="eq-slot-name">{activeOff.label}</span>
                    <button className="eq-slot-clear" onClick={() => onEquipOff(null)}>
                      Remove
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="eq-slot-empty">＋</span>
                  <span className="eq-slot-soon">{offEligible ? "Empty" : "N/A"}</span>
                </>
              )}
            </div>
          </div>

          {ARMOR_SLOTS.map((slot) => {
            const piece = getArmorPiece(armorLoadout[slot] ?? null);
            return (
              <div
                key={slot}
                className={`eq-slot ${piece ? "eq-slot-active" : ""}`}
                data-tip={piece ? `${piece.label} · def ${piece.defense ?? 0}` : `${SLOT_LABEL[slot]} empty`}
              >
                <span className="eq-slot-label">{SLOT_LABEL[slot]}</span>
                <div className="eq-slot-body">
                  {piece ? (
                    <div className="eq-slot-meta">
                      <span className="eq-slot-name">{piece.label}</span>
                      <span className="eq-slot-tag">def {piece.defense ?? 0}</span>
                    </div>
                  ) : (
                    <>
                      <span className="eq-slot-empty">＋</span>
                      <span className="eq-slot-soon">Empty</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="eq-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`eq-tab ${tab === "weapons" ? "on" : ""}`}
            aria-selected={tab === "weapons"}
            onClick={() => setTab("weapons")}
          >
            Weapons
          </button>
          <button
            type="button"
            role="tab"
            className={`eq-tab ${tab === "armor" ? "on" : ""}`}
            aria-selected={tab === "armor"}
            onClick={() => setTab("armor")}
          >
            Armor
            {defense > 0 && <span className="eq-tab-def">DEF {defense}</span>}
          </button>
        </div>

        <div className="eq-search">
          <input
            type="text"
            placeholder={tab === "weapons" ? "Search weapons…" : "Search armor sets…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <span className="eq-count">{totalShown}</span>
        </div>

        <div className="eq-grid-scroll">
          {tab === "weapons" && (
            <>
              {OFF_HAND_WEAPONS.length > 0 && (
                <section className="eq-group">
                  <h3 className="eq-group-head">
                    Off-Hand <span>{OFF_HAND_WEAPONS.length}</span>
                  </h3>
                  {!offEligible && (
                    <p className="eq-offhand-note">
                      Equip a single one-handed weapon (or unarmed) to use an off-hand — dual-wielding
                      and two-handed kits already occupy that hand.
                    </p>
                  )}
                  <div className="eq-grid">
                    <button
                      className={`eq-card ${!currentOffHand ? "on" : ""}`}
                      onClick={() => onEquipOff(null)}
                      disabled={!offEligible}
                      data-tip="Clear the off-hand slot"
                    >
                      <Icon name={WEAPON_ICON["none"]} size={28} className="eq-card-icon" />
                      <span className="eq-card-name">None</span>
                      {!currentOffHand && <span className="eq-card-badge">Equipped</span>}
                    </button>
                    {OFF_HAND_WEAPONS.map((w) => {
                      const on = w.id === currentOffHand;
                      return (
                        <button
                          key={w.id}
                          className={`eq-card ${on ? "on" : ""}`}
                          onClick={() => onEquipOff(w.id)}
                          disabled={!offEligible}
                          data-tip={`${w.label} — equip in your off-hand`}
                        >
                          <Icon name={WEAPON_ICON[w.id]} size={28} className="eq-card-icon" />
                          <span className="eq-card-name">{w.label}</span>
                          {on && <span className="eq-card-badge">Equipped</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {groups.map((g) => (
                <section className="eq-group" key={g.id}>
                  <h3 className="eq-group-head">
                    {g.label} <span>{g.items.length}</span>
                  </h3>
                  <div className="eq-grid">
                    {g.items.map((w) => {
                      const on = w.id === currentWeapon;
                      return (
                        <button
                          key={w.id}
                          className={`eq-card ${on ? "on" : ""}`}
                          onClick={() => onEquip(w.id)}
                          data-tip={`${w.label} — ${w.animSet} moveset`}
                        >
                          <Icon name={WEAPON_ICON[w.id]} size={28} className="eq-card-icon" />
                          <span className="eq-card-name">{w.label}</span>
                          {on && <span className="eq-card-badge">Equipped</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {groups.length === 0 && <p className="eq-empty">No weapons match “{query}”.</p>}
            </>
          )}

          {tab === "armor" && (
            <section className="eq-group">
              <h3 className="eq-group-head">
                Armor sets <span>{armorSets.length}</span>
              </h3>
              <p className="eq-offhand-note">
                Minecraft-style full sets (head · chest · legs · feet). Preview on the armor stand
                asset; worn bone-attach is the same slot model when mesh pieces land.
              </p>
              <div className="eq-grid">
                <button
                  className={`eq-card ${!activeSetId && defense === 0 ? "on" : ""}`}
                  onClick={() => onArmorLoadout(emptyArmorLoadout())}
                  data-tip="Clear all armor slots"
                >
                  <span className="eq-card-name">Unequip</span>
                  {!activeSetId && defense === 0 && (
                    <span className="eq-card-badge">Bare</span>
                  )}
                </button>
                {armorSets.map((s) => {
                  const on = s.id === activeSetId;
                  return (
                    <button
                      key={s.id}
                      className={`eq-card ${on ? "on" : ""}`}
                      onClick={() => onArmorLoadout(loadoutFromSet(s.id))}
                      data-tip={`${s.description} · DEF ${s.defense}`}
                    >
                      <span className="eq-card-name">{s.label}</span>
                      <span className="eq-card-mat">{s.material}</span>
                      <span className="eq-card-def">DEF {s.defense}</span>
                      {on && <span className="eq-card-badge">Equipped</span>}
                    </button>
                  );
                })}
              </div>
              {armorSets.length === 0 && <p className="eq-empty">No armor sets match “{query}”.</p>}
              {activeSetId && (
                <p className="eq-armor-active">
                  Active: <strong>{getArmorSet(activeSetId)?.label}</strong> · stand node{" "}
                  <code>{getArmorSet(activeSetId)?.standNode}</code>
                </p>
              )}
            </section>
          )}
        </div>

        <footer className="eq-foot">
          <span>
            Click to equip · <kbd>I</kbd> toggle · <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}
