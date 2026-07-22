import { useState } from "react";
import type { EditorScene } from "../../three/editor/EditorScene";
import type { EditorSnapshot } from "../../three/editor/types";
import { VFX_PRESETS } from "../../three/editor/vfxCatalog";
import { PLAYABLE_CHARACTERS, getCharacter } from "../../three/assets";
import {
  RACE_IDS,
  RACE_ASSETS,
  PRESET_IDS,
  getPreset,
  type PresetId,
  type RaceId,
} from "../../three/grudge";

interface Props {
  engine: EditorScene;
  snap: EditorSnapshot;
}

/** A labeled range slider that reads a number and reports it back live. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="ed-field">
      <label className="ed-label" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span style={{ opacity: 0.7 }}>{fmt ? fmt(value) : value.toFixed(2)}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%" }}
      />
    </div>
  );
}

/**
 * The Playground: spawn customizable Grudge race characters streamed from the
 * asset host, then drive one with the Animator's 3rd-person Controller in Play
 * mode (WASD move, mouse-look, Space jump, LMB attack, 1-5 fire VFX).
 */
export function PlaygroundPanel({ engine, snap }: Props) {
  const [race, setRace] = useState<RaceId>(RACE_IDS[0]);
  const [preset, setPreset] = useState<PresetId>("knight");
  const [charId, setCharId] = useState<string>(PLAYABLE_CHARACTERS[0]?.id ?? "explorer");

  const presetInfo = getPreset(race, preset);
  const chars = snap.grudgeChars;
  const charName =
    PLAYABLE_CHARACTERS.find((c) => c.id === charId)?.name ??
    getCharacter(charId).name;
  const canPlay = chars.length > 0 || snap.hasRig;

  return (
    <div className="ed-panel grow">
      <div className="ed-panel-head">
        <span>Playground</span>
        {snap.playing && <span style={{ color: "#7CFFB2", textTransform: "none" }}>● Playing</span>}
      </div>
      <div className="ed-panel-body">
        <div className="ed-field">
          <label className="ed-label">Race</label>
          <select
            className="ed-select"
            value={race}
            onChange={(e) => setRace(e.target.value as RaceId)}
            disabled={snap.playing}
          >
            {RACE_IDS.map((id) => (
              <option key={id} value={id}>
                {RACE_ASSETS[id].name}
              </option>
            ))}
          </select>
        </div>

        <div className="ed-field">
          <label className="ed-label">Class</label>
          <select
            className="ed-select"
            value={preset}
            onChange={(e) => setPreset(e.target.value as PresetId)}
            disabled={snap.playing}
          >
            {PRESET_IDS.map((id) => {
              const p = getPreset(race, id);
              return (
                <option key={id} value={id}>
                  {p.label} — {p.description}
                </option>
              );
            })}
          </select>
        </div>

        <button
          className="ed-btn"
          style={{ width: "100%" }}
          disabled={snap.busy || snap.playing}
          onClick={() => void engine.loadGrudgeCharacter(race, preset)}
        >
          {snap.busy ? "Loading…" : `+ Spawn ${RACE_ASSETS[race].name} ${presetInfo.label}`}
        </button>

        <div className="ed-divider" />

        <div className="ed-field">
          <label className="ed-label">Character</label>
          <select
            className="ed-select"
            value={charId}
            onChange={(e) => setCharId(e.target.value)}
            disabled={snap.playing}
          >
            {PLAYABLE_CHARACTERS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <button
          className="ed-btn"
          style={{ width: "100%" }}
          disabled={snap.busy || snap.playing}
          onClick={() => void engine.loadPlayableCharacter(charId)}
        >
          {snap.busy ? "Loading…" : `+ Spawn ${charName}`}
        </button>

        <div className="ed-divider" />

        <div className="ed-subhead">
          <span>Characters — {chars.length}</span>
          {canPlay && !snap.playing && (
            <button className="ed-btn" onClick={() => engine.startPlay()}>
              ▶ Play
            </button>
          )}
          {snap.playing && (
            <button className="ed-btn danger" onClick={() => engine.stopPlay()}>
              ■ Stop
            </button>
          )}
        </div>

        {chars.length === 0 ? (
          <div className="ed-empty">
            {snap.hasRig
              ? "Press Play to drive the dressed rig, or spawn a character above."
              : "Spawn a character, then press Play to drive it."}
          </div>
        ) : (
          <div className="ed-list">
            {chars.map((c) => (
              <div key={c.rootId} className="ed-row">
                <span className="nm">{c.name}</span>
                <button
                  className="ed-btn"
                  disabled={snap.playing}
                  onClick={() => engine.startPlay(c.rootId)}
                  title="Drive this character"
                >
                  ▶
                </button>
                <button
                  className="ed-btn danger"
                  disabled={snap.playing}
                  onClick={() => engine.unloadGrudge(c.rootId)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="ed-divider" />
        <div className="ed-subhead">Controls</div>
        <p
          className="ed-hint"
          style={{ position: "static", transform: "none", display: "block", lineHeight: 1.7 }}
        >
          <b>WASD</b> move · <b>Mouse</b> look · <b>Shift</b> sprint · <b>Space</b> jump
          <br />
          <b>LMB</b> attack · <b>1-5</b> cast VFX · <b>Esc</b> release cursor
        </p>

        <SkillLab engine={engine} snap={snap} />
      </div>
    </div>
  );
}

/**
 * Skill Lab — live animation + skill authoring for the target Playground
 * character (the one being driven in Play mode, else the selected one). Tune
 * playback overdrive, mirror, arm width, trim a clip into a sub-clip, place a
 * damaging hit sphere, bind a slash trail to it, and pick the VFX the skill
 * fires — then Test Skill to preview the whole thing.
 */
function SkillLab({ engine, snap }: Props) {
  const lab = snap.skillLab;
  if (!lab.available) {
    return (
      <>
        <div className="ed-divider" />
        <div className="ed-subhead">Skill Lab</div>
        <div className="ed-empty">Select or play a character to author its skills.</div>
      </>
    );
  }
  const set = engine.setSkillLab.bind(engine);
  return (
    <>
      <div className="ed-divider" />
      <div className="ed-subhead">Skill Lab</div>

      <div className="ed-field">
        <label className="ed-label">Clip</label>
        <select
          className="ed-select"
          value={lab.clipName ?? ""}
          onChange={(e) => set("clipName", e.target.value || null)}
        >
          <option value="">Attack (default)</option>
          {lab.clips.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <Slider
        label="Overdrive (speed)"
        value={lab.overdrive}
        min={0.25}
        max={3}
        step={0.05}
        fmt={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => set("overdrive", v)}
      />
      <Slider
        label="Arm width"
        value={lab.armWidth}
        min={-1}
        max={1}
        step={0.05}
        onChange={(v) => set("armWidth", v)}
      />

      <label className="ed-slider-row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={lab.mirror} onChange={(e) => set("mirror", e.target.checked)} />
        Mirror (swap left/right)
      </label>

      <div className="ed-subhead" style={{ marginTop: 8 }}>
        Clip trim (sub-clip)
      </div>
      <Slider
        label="In"
        value={lab.clipFrom}
        min={0}
        max={1}
        step={0.01}
        fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => set("clipFrom", v)}
      />
      <Slider
        label="Out"
        value={lab.clipTo}
        min={0}
        max={1}
        step={0.01}
        fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => set("clipTo", v)}
      />

      <div className="ed-subhead" style={{ marginTop: 8 }}>
        Damaging collider
      </div>
      <Slider label="Offset X" value={lab.colliderX} min={-1.5} max={1.5} step={0.05} onChange={(v) => set("colliderX", v)} />
      <Slider label="Offset Y" value={lab.colliderY} min={0} max={3} step={0.05} onChange={(v) => set("colliderY", v)} />
      <Slider label="Offset Z" value={lab.colliderZ} min={-1.5} max={2} step={0.05} onChange={(v) => set("colliderZ", v)} />
      <Slider label="AOE radius" value={lab.colliderRadius} min={0.1} max={2.5} step={0.05} onChange={(v) => set("colliderRadius", v)} />
      <label className="ed-slider-row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={lab.showCollider} onChange={(e) => set("showCollider", e.target.checked)} />
        Show collider
      </label>
      <label className="ed-slider-row" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={lab.slashFromCollider}
          onChange={(e) => set("slashFromCollider", e.target.checked)}
        />
        Emit VFX from collider (angle + position)
      </label>

      <div className="ed-field" style={{ marginTop: 8 }}>
        <label className="ed-label">Skill VFX</label>
        <select className="ed-select" value={lab.vfxId} onChange={(e) => set("vfxId", e.target.value)}>
          {VFX_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <button className="ed-btn" style={{ width: "100%", marginTop: 8 }} onClick={() => engine.testSkill()}>
        ⚡ Test Skill
      </button>
    </>
  );
}
