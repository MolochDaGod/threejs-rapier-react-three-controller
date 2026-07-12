import { useEffect, useMemo, useRef, useState } from "react";
import { Shirt, Upload, UserPlus, Sparkles, X } from "lucide-react";
import type { EditorScene } from "../../three/editor/EditorScene";
import type { EditorObjectSnapshot, EditorSnapshot } from "../../three/editor/types";
import type { VoxelPart } from "../../three/explorer/rig";
import { CHARACTERS } from "../../three/assets";
import { RACE_ASSETS, RACE_IDS, PRESET_IDS } from "../../three/grudge";
import type { RaceId, PresetId } from "../../three/grudge";
import { SHELLS, type ShellId } from "../../three/LedMaskShells";

interface Props {
  engine: EditorScene;
  snap: EditorSnapshot;
  /** Authed backend image generator (data URL) for voxel-character patterns. */
  generatePattern?: (prompt: string) => Promise<string>;
}

/** Voxel-character parts the wardrobe exposes (subset of VoxelPart). */
const VOXEL_PARTS: { id: VoxelPart; label: string; color: string }[] = [
  { id: "skin", label: "Skin", color: "#f1c9a5" },
  { id: "shirt", label: "Shirt", color: "#3f8fd0" },
  { id: "pants", label: "Pants", color: "#3a3f4a" },
  { id: "boot", label: "Boots", color: "#5b3a22" },
  { id: "hat", label: "Hat / Wrap", color: "#b23b3b" },
  { id: "eye", label: "Eyes", color: "#141821" },
];

/**
 * Per-part colour + AI pattern controls for the procedural voxel character.
 * Only shown when the live rig is the procedural voxel rig (snap.rigIsVoxel).
 */
function VoxelCharacterSection({
  engine,
  generatePattern,
}: {
  engine: EditorScene;
  generatePattern?: (prompt: string) => Promise<string>;
}) {
  const [colors, setColors] = useState<Record<string, string>>(() =>
    Object.fromEntries(VOXEL_PARTS.map((p) => [p.id, p.color])),
  );
  const [patternPart, setPatternPart] = useState<VoxelPart>("hat");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // "none" = no LED mask (skin face); otherwise the worn housing shell id.
  const [ledShell, setLedShell] = useState<ShellId | "none">("none");

  const onGenerate = async () => {
    if (!generatePattern || !prompt.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const dataUrl = await generatePattern(
        `Seamless tileable flat pattern texture, top-down, no perspective, no shadows, no borders: ${prompt.trim()}`,
      );
      await engine.applyRigPattern(patternPart, dataUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="ed-subhead" style={{ marginTop: 16 }}>
        <span>Voxel Character</span>
        <Sparkles size={13} />
      </div>
      {VOXEL_PARTS.map((p) => (
        <div key={p.id} className="ed-gear-row">
          <span className="nm">{p.label}</span>
          <input
            type="color"
            value={colors[p.id]}
            onChange={(e) => {
              setColors((c) => ({ ...c, [p.id]: e.target.value }));
              engine.recolorRigPart(p.id, parseInt(e.target.value.slice(1), 16));
            }}
          />
        </div>
      ))}

      <div className="ed-label" style={{ marginTop: 10 }}>
        AI pattern
      </div>
      <div className="ed-field">
        <select
          className="ed-select"
          value={patternPart}
          onChange={(e) => setPatternPart(e.target.value as VoxelPart)}
        >
          {VOXEL_PARTS.filter((p) => p.id !== "eye").map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="ed-select"
        style={{ width: "100%", minHeight: 52, resize: "vertical", marginTop: 6 }}
        placeholder="Describe a pattern (e.g. desert camo, gold paisley head wrap)"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="ed-row" style={{ marginTop: 6 }}>
        <button
          className="ed-btn"
          disabled={!generatePattern || !prompt.trim() || busy}
          onClick={() => void onGenerate()}
        >
          <Sparkles size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
          {busy ? "Generating…" : "Generate"}
        </button>
        <button
          className="ed-btn"
          title="Clear pattern from this part"
          onClick={() => engine.clearRigPattern(patternPart)}
        >
          <X size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
          Clear
        </button>
      </div>
      {err && (
        <div className="ed-empty" style={{ padding: "6px", color: "#e07a7a" }}>
          {err}
        </div>
      )}

      <div className="ed-label" style={{ marginTop: 12 }}>
        LED mask head
      </div>
      <div className="ed-field">
        <select
          className="ed-select"
          value={ledShell}
          onChange={(e) => {
            const v = e.target.value as ShellId | "none";
            setLedShell(v);
            engine.setRigLedShell(v === "none" ? null : v);
          }}
        >
          <option value="none">None (skin face)</option>
          {SHELLS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.glyph} {s.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/**
 * Character loader — spawn any catalog character (procedural rigs + GLB fighters)
 * or one of the six Grudge races (with a gear preset) into the Dressing Room.
 */
function CharacterLoader({ engine }: { engine: EditorScene }) {
  const [catId, setCatId] = useState<string>(CHARACTERS[0]?.id ?? "explorer");
  const [race, setRace] = useState<RaceId>(RACE_IDS[0]);
  const [preset, setPreset] = useState<PresetId>("warrior");
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <div className="ed-field">
      <label className="ed-label">Load character</label>
      <div className="ed-row">
        <select className="ed-select" value={catId} onChange={(e) => setCatId(e.target.value)}>
          {CHARACTERS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className="ed-btn ed-tw"
          title="Load this character"
          onClick={() => void engine.loadCatalogCharacter(catId)}
        >
          <UserPlus size={14} />
        </button>
      </div>
      <div className="ed-row" style={{ marginTop: 6 }}>
        <select className="ed-select" value={race} onChange={(e) => setRace(e.target.value as RaceId)}>
          {RACE_IDS.map((r) => (
            <option key={r} value={r}>
              {RACE_ASSETS[r].name}
            </option>
          ))}
        </select>
        <select className="ed-select" value={preset} onChange={(e) => setPreset(e.target.value as PresetId)}>
          {PRESET_IDS.map((p) => (
            <option key={p} value={p}>
              {cap(p)}
            </option>
          ))}
        </select>
        <button
          className="ed-btn ed-tw"
          title="Load this Grudge race"
          onClick={() => void engine.loadGrudgeCharacter(race, preset)}
        >
          <UserPlus size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * Catalog accessories (worn cosmetics) — loaded into the scene and auto-attached
 * to a character bone, then fine-tuned with the gizmo. `preRotX` reorients a
 * model whose "up" axis is +Z (the crown) onto world +Y.
 */
const ACCESSORIES: {
  id: string;
  label: string;
  file: string;
  bone: string;
  targetHeight: number;
  preRotX?: number;
}[] = [
  {
    id: "golden-crown",
    label: "Golden Crown",
    file: "models/gear/golden-crown.glb",
    bone: "head",
    targetHeight: 0.26,
    preRotX: -Math.PI / 2,
  },
];

/** Quick-pick skin palette (armour / cloth / metal / skin tones). */
const SWATCHES = [
  0xb23b3b, 0xd9772e, 0xe7c14b, 0x5aa658, 0x3f8fd0, 0x6a52c8, 0xc24f9a, 0xe8e2d4, 0xa9b1bd, 0x6b7280,
  0x3a3f4a, 0x141821, 0x8a5a2b, 0x5b3a22, 0xf1c9a5, 0x2b6c5a,
];

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/**
 * Wardrobe — apply skins (recolour / retexture / material feel) to a character
 * and attach visible gear (any imported model) onto its bones. Lets you dress a
 * rig up with lots of different gear and give it a custom look, live.
 */
export function WardrobePanel({ engine, snap, generatePattern }: Props) {
  // Root-level rigs / models are the dressable characters.
  const characters = useMemo(
    () => snap.objects.filter((o) => o.parentId === null && (o.kind === "rig" || o.kind === "model")),
    [snap.objects],
  );
  const [charId, setCharId] = useState<string | null>(null);
  const active = characters.find((c) => c.id === charId) ?? characters[0] ?? null;
  useEffect(() => {
    if (active && active.id !== charId) setCharId(active.id);
  }, [active, charId]);

  // Gear you can attach: other root-level models. "Worn" gear: models that have
  // been parented onto something (i.e. attached to a character / bone).
  const gearCandidates = useMemo(
    () => snap.objects.filter((o) => o.parentId === null && o.kind === "model" && o.id !== active?.id),
    [snap.objects, active?.id],
  );
  const worn = useMemo(
    () => snap.objects.filter((o) => o.kind === "model" && o.parentId !== null),
    [snap.objects],
  );

  const [bone, setBone] = useState<string>("");
  const bones = useMemo(() => (active ? engine.listBones(active.id) : []), [engine, active?.id, snap.objects]);
  const [color, setColor] = useState("#b23b3b");
  const [rough, setRough] = useState(0.7);
  const [metal, setMetal] = useState(0.0);
  const texRef = useRef<HTMLInputElement>(null);

  const skin = (opts: Parameters<EditorScene["applySkin"]>[1]) => {
    if (active) void engine.applySkin(active.id, opts);
  };

  const onTexture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !active) return;
    const reader = new FileReader();
    reader.onload = () => skin({ textureDataUrl: reader.result as string });
    reader.readAsDataURL(file);
  };

  if (!characters.length) {
    return (
      <div className="ed-panel-body">
        <div className="ed-empty">
          No characters yet.
          <br />
          Pick a character below to load it, or import a model, then dress it up here.
        </div>
        <CharacterLoader engine={engine} />
      </div>
    );
  }

  return (
    <div className="ed-panel-body">
      <CharacterLoader engine={engine} />
      <div className="ed-field">
        <label className="ed-label">Character</label>
        <select className="ed-select" value={active?.id ?? ""} onChange={(e) => setCharId(e.target.value)}>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {snap.rigIsVoxel && (
        <VoxelCharacterSection engine={engine} generatePattern={generatePattern} />
      )}

      <div className="ed-subhead">
        <span>Skin</span>
        <Shirt size={13} />
      </div>
      <div className="ed-swatches">
        {SWATCHES.map((c) => (
          <button
            key={c}
            className="ed-swatch"
            style={{ background: hex(c) }}
            title={hex(c)}
            onClick={() => {
              setColor(hex(c));
              skin({ color: c });
            }}
          />
        ))}
      </div>
      <div className="ed-colorbar">
        <input
          type="color"
          value={color}
          onChange={(e) => {
            setColor(e.target.value);
            skin({ color: parseInt(e.target.value.slice(1), 16) });
          }}
        />
        <button className="ed-btn" onClick={() => texRef.current?.click()}>
          <Upload size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
          Texture
        </button>
      </div>

      <div className="ed-slider-row" style={{ marginTop: 10 }}>
        <span className="nm">Roughness</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={rough}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setRough(v);
            skin({ roughness: v });
          }}
        />
        <span className="val">{rough.toFixed(2)}</span>
      </div>
      <div className="ed-slider-row">
        <span className="nm">Metalness</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={metal}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setMetal(v);
            skin({ metalness: v });
          }}
        />
        <span className="val">{metal.toFixed(2)}</span>
      </div>

      <div className="ed-subhead" style={{ marginTop: 16 }}>
        <span>Gear</span>
      </div>
      <div className="ed-field">
        <label className="ed-label">Attach to</label>
        <select className="ed-select" value={bone} onChange={(e) => setBone(e.target.value)}>
          <option value="">Character root</option>
          {bones.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      {worn.length > 0 && (
        <>
          <div className="ed-label">Worn</div>
          {worn.map((g: EditorObjectSnapshot) => (
            <div key={g.id} className="ed-gear-row">
              <span className="nm">{g.name}</span>
              <button className="ed-mini danger" onClick={() => engine.detachGear(g.id)}>
                Detach
              </button>
            </div>
          ))}
        </>
      )}

      <div className="ed-label" style={{ marginTop: 8 }}>
        Accessories
      </div>
      {ACCESSORIES.map((a) => (
        <div key={a.id} className="ed-gear-row">
          <span className="nm">{a.label}</span>
          <button
            className="ed-mini"
            disabled={!active}
            title={`Add and wear on ${a.bone}`}
            onClick={() =>
              active &&
              void engine.loadAccessory(a.file, a.label, {
                targetHeight: a.targetHeight,
                preRotX: a.preRotX,
                attachTo: active.id,
                bone: a.bone,
              })
            }
          >
            Wear
          </button>
        </div>
      ))}

      <div className="ed-label" style={{ marginTop: 8 }}>
        Available
      </div>
      {gearCandidates.length === 0 ? (
        <div className="ed-empty" style={{ padding: "8px 6px" }}>
          Import a model (weapon, armour, prop) to use it as gear.
        </div>
      ) : (
        gearCandidates.map((g) => (
          <div key={g.id} className="ed-gear-row">
            <span className="nm">{g.name}</span>
            <button
              className="ed-mini"
              disabled={!active}
              onClick={() => active && engine.attachGear(active.id, g.id, bone || null)}
            >
              Attach
            </button>
          </div>
        ))
      )}

      <input ref={texRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onTexture} />
    </div>
  );
}
