import { useRef } from "react";
import type { ChangeEvent } from "react";
import type { EditorScene } from "../../three/editor/EditorScene";
import type { EditorSnapshot, WeaponLibEntry } from "../../three/editor/types";

interface Props {
  engine: EditorScene;
  snap: EditorSnapshot;
}

/** Display order + headings for the weapon families surfaced by the library. */
const GROUP_ORDER: { id: string; label: string }[] = [
  { id: "melee-1h", label: "One-handed" },
  { id: "melee-2h", label: "Two-handed" },
  { id: "off-hand", label: "Off-hand" },
  { id: "ranged", label: "Ranged" },
  { id: "magic", label: "Magic" },
  { id: "unarmed", label: "Unarmed" },
  { id: "custom", label: "Imported" },
];

const RAD = 180 / Math.PI;
const deg = (r: number) => Math.round(r * RAD);
const rad = (d: number) => d / RAD;

/**
 * The weapon arsenal: every catalog prefab (grouped by family, with named tier
 * variants) plus imported "custom" weapons. Equipping mirrors the real combat
 * equip path — the rig swaps to the weapon's clip set AND the prefab's GLB model
 * mounts on the hand, bringing its bundled grip / skill / VFX along. While
 * equipped, in-viewport markers show the hand socket + weapon tip, and a
 * size/grip gizmo writes placement overrides back onto the prefab live.
 */
export function WeaponLibraryPanel({ engine, snap }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const equipped = snap.equippedWeapon;
  const edit = snap.weaponEdit;
  const current: WeaponLibEntry | undefined = snap.weapons.find((w) => w.id === equipped);

  const onImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void engine.importWeapon(file);
    e.target.value = "";
  };

  const equip = (w: WeaponLibEntry) => {
    if (w.custom) engine.equipCustomWeapon(w.id.slice(7));
    else void engine.equipWeapon(w.id, 0);
  };

  const setGrip = (axis: 0 | 1 | 2, kind: "pos" | "rot", value: number) => {
    if (!edit) return;
    const pos: [number, number, number] = [...edit.pos];
    const rot: [number, number, number] = [...edit.rot];
    if (kind === "pos") pos[axis] = value;
    else rot[axis] = rad(value);
    void engine.setWeaponGrip(pos, rot);
  };

  const setHit = (patch: Partial<{ startFrac: number; endFrac: number; radius: number }>) => {
    if (!edit?.hit) return;
    const h = { ...edit.hit, ...patch };
    void engine.setWeaponHit(h.startFrac, h.endFrac, h.radius);
  };

  return (
    <div className="ed-panel grow">
      <div className="ed-panel-head">
        <span>Arsenal</span>
        <span style={{ opacity: 0.6 }}>{snap.weapons.length}</span>
      </div>
      <div className="ed-panel-body">
        {/* Equip toolbar */}
        <div className="ed-row-actions" style={{ marginBottom: 10 }}>
          <button className="ed-btn" onClick={() => fileRef.current?.click()}>
            Import weapon
          </button>
          {equipped && (
            <button className="ed-btn danger" onClick={() => engine.unequipWeapon()}>
              Unequip
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".glb,.gltf,.fbx,.obj,.zip,.bbmodel"
          style={{ display: "none" }}
          onChange={onImport}
        />

        {/* Connection markers toggle */}
        <label className="ed-slider-row" style={{ cursor: "pointer", marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={snap.weaponMarkers}
            onChange={(e) => engine.setWeaponMarkers(e.target.checked)}
          />
          <span className="nm" style={{ flex: 1 }}>
            Connection markers
          </span>
          <span style={{ fontSize: 10, color: "#9fb2d6" }}>hand · tip</span>
        </label>

        {/* Placement gizmo for the equipped weapon */}
        {edit && current && (
          <div className="ed-field" style={{ marginBottom: 12 }}>
            <div className="ed-subhead">
              <span>{current.label} placement</span>
              <span style={{ color: edit.catalog ? "#7fd6a0" : "#ffb24d", fontWeight: 700 }}>
                {edit.catalog ? "prefab" : "import"}
              </span>
            </div>

            {/* Tier variant selector (catalog data only) */}
            {current.tiers.length > 0 && (
              <div className="ed-field" style={{ marginBottom: 8 }}>
                <label className="ed-label">Tier</label>
                <select
                  className="ed-select"
                  value={snap.equippedTier}
                  onChange={(e) => engine.setWeaponTier(Number(e.target.value))}
                >
                  {current.tiers.map((t, i) => (
                    <option key={t.name} value={i}>
                      {t.name}
                      {t.power != null ? ` (×${t.power})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Size */}
            <div className="ed-slider-row">
              <span className="nm">Size</span>
              <input
                type="range"
                min={0.1}
                max={edit.catalog ? 4 : 5}
                step={0.01}
                value={edit.size}
                onChange={(e) => void engine.setWeaponSize(Number(e.target.value))}
              />
              <span className="val">{edit.size.toFixed(2)}</span>
            </div>

            {/* Grip position */}
            {(["X", "Y", "Z"] as const).map((ax, i) => (
              <div className="ed-slider-row" key={`p${ax}`}>
                <span className="nm">Grip {ax}</span>
                <input
                  type="range"
                  min={-0.6}
                  max={0.6}
                  step={0.005}
                  value={edit.pos[i]}
                  onChange={(e) => setGrip(i as 0 | 1 | 2, "pos", Number(e.target.value))}
                />
                <span className="val">{edit.pos[i].toFixed(2)}</span>
              </div>
            ))}

            {/* Grip rotation */}
            {(["X", "Y", "Z"] as const).map((ax, i) => (
              <div className="ed-slider-row" key={`r${ax}`}>
                <span className="nm">Rot {ax}</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={deg(edit.rot[i])}
                  onChange={(e) => setGrip(i as 0 | 1 | 2, "rot", Number(e.target.value))}
                />
                <span className="val">{deg(edit.rot[i])}°</span>
              </div>
            ))}

            {/* Swept blade collider (blade weapons only) */}
            {edit.hit && (
              <div className="ed-field" style={{ marginTop: 10 }}>
                <div className="ed-subhead">
                  <span>Blade collider</span>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={edit.showCollider}
                      onChange={(e) => engine.setWeaponCollider(e.target.checked)}
                    />
                    <span style={{ fontSize: 10, color: "#9fb2d6" }}>show</span>
                  </label>
                </div>
                <div className="ed-slider-row">
                  <span className="nm">Edge start</span>
                  <input
                    type="range"
                    min={0}
                    max={0.9}
                    step={0.01}
                    value={edit.hit.startFrac}
                    onChange={(e) => setHit({ startFrac: Number(e.target.value) })}
                  />
                  <span className="val">{edit.hit.startFrac.toFixed(2)}</span>
                </div>
                <div className="ed-slider-row">
                  <span className="nm">Edge end</span>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.01}
                    value={edit.hit.endFrac}
                    onChange={(e) => setHit({ endFrac: Number(e.target.value) })}
                  />
                  <span className="val">{edit.hit.endFrac.toFixed(2)}</span>
                </div>
                <div className="ed-slider-row">
                  <span className="nm">Radius</span>
                  <input
                    type="range"
                    min={0.02}
                    max={0.4}
                    step={0.005}
                    value={edit.hit.radius}
                    onChange={(e) => setHit({ radius: Number(e.target.value) })}
                  />
                  <span className="val">{edit.hit.radius.toFixed(3)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Grouped weapon catalog */}
        {GROUP_ORDER.map(({ id, label }) => {
          const items = snap.weapons.filter((w) => w.group === id);
          if (items.length === 0) return null;
          return (
            <div key={id} className="ed-field">
              <div className="ed-label" style={{ opacity: 0.6 }}>
                {label} — {items.length}
              </div>
              <div className="ed-list">
                {items.map((w) => (
                  <div
                    key={w.id}
                    className={`ed-row ${equipped === w.id ? "on" : ""}`}
                    onClick={() => equip(w)}
                    title={w.custom ? "Imported model" : `${w.skillName} · ${w.animSet}`}
                  >
                    <span className="nm">{w.label}</span>
                    <span style={{ opacity: 0.5, fontSize: 11 }}>
                      {w.custom ? "import" : w.tiers.length > 0 ? `${w.tiers.length} tiers` : w.animSet}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
