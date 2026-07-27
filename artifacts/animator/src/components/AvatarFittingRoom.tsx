/**
 * Fitting Room — design/test armor sets, weapons, and body scale for the
 * avatar currently built in Avatar Edit. Stores loadout on the character prefab.
 */
import { useMemo, useState } from "react";
import { Shield, Swords, Ruler, Shirt } from "lucide-react";
import { WEAPONS, OFF_HAND_WEAPONS, offHandEligible } from "../three/arsenal";
import type { WeaponId, WeaponGroup } from "../three/types";
import {
  ARMOR_SETS,
  ARMOR_SLOTS,
  emptyArmorLoadout,
  getArmorSet,
  loadoutDefense,
  loadoutFromSet,
  type ArmorLoadout,
  type ArmorSlot,
} from "../three/equipment";
import {
  PREFAB_ROLES,
  RACE_BASE_HEIGHT_M,
  raceHeightM,
  type PrefabRole,
} from "../three/avatar/npcPrefab";
import type { AvatarConfig, RaceId } from "../three/avatar/catalog";
import { PRESET_IDS, type PresetId } from "../three/grudge";

export interface FittingState {
  role: PrefabRole;
  heightScale: number;
  bodyScaleXZ: number;
  armorSetId: string | null;
  armorLoadout: ArmorLoadout;
  weaponId: WeaponId;
  offHandId: WeaponId | null;
  gearPresetId: string;
  prefabName: string;
}

interface Props {
  face: AvatarConfig;
  value: FittingState;
  onChange: (next: FittingState) => void;
}

const GROUP_ORDER: { id: WeaponGroup; label: string }[] = [
  { id: "melee-1h", label: "1H Melee" },
  { id: "melee-2h", label: "2H Melee" },
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

const GEAR_PRESETS: { id: PresetId | "none"; label: string }[] = [
  { id: "none", label: "None" },
  ...PRESET_IDS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
];

export function defaultFittingState(race: RaceId): FittingState {
  return {
    role: "player",
    heightScale: 1,
    bodyScaleXZ: race === "dwarf" ? 1.1 : race === "elf" ? 0.92 : 1,
    armorSetId: null,
    armorLoadout: emptyArmorLoadout(),
    weaponId: "none",
    offHandId: null,
    gearPresetId: "none",
    prefabName: "",
  };
}

export function AvatarFittingRoom({ face, value, onChange }: Props) {
  const [wQuery, setWQuery] = useState("");
  const patch = (p: Partial<FittingState>) => onChange({ ...value, ...p });

  const heightM = raceHeightM(face.race, value.heightScale);
  const baseM = RACE_BASE_HEIGHT_M[face.race];
  const def = loadoutDefense(value.armorLoadout);
  const setInfo = value.armorSetId ? getArmorSet(value.armorSetId) : undefined;

  const weaponGroups = useMemo(() => {
    const q = wQuery.trim().toLowerCase();
    return GROUP_ORDER.map(({ id, label }) => ({
      id,
      label,
      items: WEAPONS.filter(
        (w) =>
          (w.group ?? "unarmed") === id &&
          (!q || w.label.toLowerCase().includes(q) || w.id.includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [wQuery]);

  const offEligible = offHandEligible(value.weaponId);

  return (
    <div className="ae-fitting">
      <section className="ae-sec">
        <h3>
          <Ruler size={13} /> Body scale (SI)
        </h3>
        <p className="ae-fit-blurb">
          Race base <strong>{baseM.toFixed(2)} m</strong> · fitted{" "}
          <strong>{heightM.toFixed(2)} m</strong> · XZ bulk ×
          {value.bodyScaleXZ.toFixed(2)}. Used on deploy for NPC/ally/enemy
          capsules — face paint stays race-relative.
        </p>
        <label className="ae-fit-row">
          <span>Height ×{value.heightScale.toFixed(2)}</span>
          <input
            type="range"
            min={0.55}
            max={1.45}
            step={0.01}
            value={value.heightScale}
            onChange={(e) => patch({ heightScale: Number(e.target.value) })}
          />
        </label>
        <label className="ae-fit-row">
          <span>Bulk XZ ×{value.bodyScaleXZ.toFixed(2)}</span>
          <input
            type="range"
            min={0.7}
            max={1.35}
            step={0.01}
            value={value.bodyScaleXZ}
            onChange={(e) => patch({ bodyScaleXZ: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="ae-sec">
        <h3>
          <Shirt size={13} /> Role &amp; name
        </h3>
        <div className="ae-chips">
          {PREFAB_ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`ae-chip ${value.role === r.id ? "on" : ""}`}
              title={r.blurb}
              onClick={() => patch({ role: r.id })}
            >
              {r.label}
            </button>
          ))}
        </div>
        <input
          className="ae-fit-input"
          placeholder={`${face.race} ${value.role}`}
          value={value.prefabName}
          onChange={(e) => patch({ prefabName: e.target.value })}
        />
        <div className="ae-label" style={{ marginTop: 10 }}>
          Grudge gear preset (modular race body)
        </div>
        <div className="ae-chips">
          {GEAR_PRESETS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`ae-chip ${value.gearPresetId === g.id ? "on" : ""}`}
              onClick={() => patch({ gearPresetId: g.id })}
            >
              {g.label}
            </button>
          ))}
        </div>
      </section>

      <section className="ae-sec">
        <h3>
          <Shield size={13} /> Armor sets
        </h3>
        <p className="ae-fit-blurb">
          Minecraft-style 4-slot loadout · stand mesh preview catalog (
          <code>mc-armor-stand</code>). Defense total: <strong>{def}</strong>
          {setInfo ? ` · ${setInfo.label}` : ""}.
        </p>
        <div className="ae-armor-sets">
          <button
            type="button"
            className={`ae-armor-card ${!value.armorSetId ? "on" : ""}`}
            onClick={() =>
              patch({ armorSetId: null, armorLoadout: emptyArmorLoadout() })
            }
          >
            <span className="nm">Bare</span>
            <span className="meta">No armor</span>
          </button>
          {ARMOR_SETS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`ae-armor-card ${value.armorSetId === s.id ? "on" : ""}`}
              onClick={() =>
                patch({
                  armorSetId: s.id,
                  armorLoadout: loadoutFromSet(s.id),
                })
              }
            >
              <span className="nm">{s.label}</span>
              <span className="meta">
                {s.material} · def {s.defense}
              </span>
            </button>
          ))}
        </div>
        <div className="ae-armor-slots">
          {ARMOR_SLOTS.map((slot) => (
            <div key={slot} className="ae-armor-slot">
              <span>{SLOT_LABEL[slot]}</span>
              <code>{value.armorLoadout[slot] ?? "—"}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="ae-sec">
        <h3>
          <Swords size={13} /> Weapons
        </h3>
        <input
          className="ae-fit-input"
          placeholder="Filter weapons…"
          value={wQuery}
          onChange={(e) => setWQuery(e.target.value)}
        />
        {weaponGroups.map((g) => (
          <div key={g.id} className="ae-wgroup">
            <div className="ae-label">{g.label}</div>
            <div className="ae-chips">
              {g.items.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`ae-chip ${value.weaponId === w.id ? "on" : ""}`}
                  onClick={() =>
                    patch({
                      weaponId: w.id,
                      offHandId: offHandEligible(w.id) ? value.offHandId : null,
                    })
                  }
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {offEligible && (
          <>
            <div className="ae-label" style={{ marginTop: 10 }}>
              Off-hand
            </div>
            <div className="ae-chips">
              <button
                type="button"
                className={`ae-chip ${!value.offHandId ? "on" : ""}`}
                onClick={() => patch({ offHandId: null })}
              >
                Empty
              </button>
              {OFF_HAND_WEAPONS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`ae-chip ${value.offHandId === w.id ? "on" : ""}`}
                  onClick={() => patch({ offHandId: w.id })}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
