import { useState } from "react";
import { CHARACTERS, WEAPONS } from "../three/assets";
import type {
  AleActor,
  AleCameraMode,
  AlePlatform,
  AleSnapshot,
  Difficulty,
  DuelState,
  Faction,
  ReplayFrequency,
  WeaponId,
} from "../three/types";
import { WEAPON_ICON } from "../three/icons";
import { BACKDROPS, ROOM_PRESETS, type RoomPresetId } from "../three/RoomPresets";
import {
  DUNGEON_MAP_LIST,
  loadDungeonMap,
  saveDungeonMap,
  type DungeonMapId,
} from "../three/DungeonMaps";
import { Icon } from "./Icon";
import { EnvPreview } from "./EnvThumb";
import { AleReviewPlayer } from "./AleReviewPlayer";

const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: "passive", label: "Passive" },
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
];

const FACTIONS: { id: Faction; label: string }[] = [
  { id: "enemy", label: "Enemy" },
  { id: "ally", label: "Ally" },
];

const ALE_CAMS: { id: AleCameraMode; label: string }[] = [
  { id: "off", label: "Player" },
  { id: "director", label: "Drone" },
  { id: "orbit", label: "Orbit" },
  { id: "povA", label: "POV A" },
  { id: "povB", label: "POV B" },
];

/** Cameras a viewer may cut to while scrubbing a replay (no "Player" view). */
const REPLAY_CAMS: { id: AleCameraMode; label: string }[] = ALE_CAMS.filter(
  (c) => c.id !== "off",
);

/** Replay playback-rate presets. */
const REPLAY_SPEEDS = [0.25, 0.5, 1] as const;

const REPLAY_FREQS: { id: ReplayFrequency; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Never interrupt the action" },
  { id: "ko", label: "KO Only", hint: "Only replay the finishing blow" },
  { id: "rare", label: "Rare", hint: "Only the biggest moments" },
  { id: "highlights", label: "Highlights", hint: "Crits, parries & big hits" },
  { id: "frequent", label: "Frequent", hint: "Replay almost every spike" },
];

const PLATFORM_LABEL: Record<AlePlatform, string> = {
  "grudge-studio": "Grudge Studio",
  discord: "Discord",
  youtube: "YouTube",
  twitter: "Twitter / X",
  instagram: "Instagram",
  forum: "Forum",
};

const ACTOR_LABEL: Record<AleActor, string> = {
  A: "P1",
  B: "P2",
  ale: "A.L.E.",
};

interface Props {
  open: boolean;
  characterId: string;
  weaponId: WeaponId;
  difficulty: Difficulty;
  onCharacter: (id: string) => void;
  onWeapon: (id: WeaponId) => void;
  onDifficulty: (d: Difficulty) => void;
  onSpawn: (weaponId: WeaponId, faction: Faction) => void;
  onSpawnBoss: (weaponId: WeaponId) => void;
  onClearNpcs: () => void;
  onClose: () => void;
  /** Live AI-vs-AI duel snapshot, or null when no duel is running. */
  duel: DuelState | null;
  onStartDuel: (teamSize: number) => void;
  onStopDuel: () => void;
  /** The training environment the duel/session will take place in. */
  roomPreset: RoomPresetId;
  /** Active full-scene battle-art backdrop id, or null for the plain preset bg. */
  backdropId: string | null;
  onBackdrop: (id: string | null) => void;
  /** A.L.E. Bot state (cameras / highlights / diagnostics / report), or null. */
  ale: AleSnapshot | null;
  onDuelCamera: (mode: AleCameraMode) => void;
  onToggleDiagnostics: () => void;
  /** Play an instant replay of the last seconds of recorded fight footage. */
  onStartReplay: () => void;
  /** Pause/resume the active replay's playhead. */
  onReplayPause: (paused: boolean) => void;
  /** Set the active replay's playback rate (1 = recorded real-time). */
  onReplaySpeed: (speed: number) => void;
  /** Scrub the active replay's playhead to a 0..1 window position. */
  onReplaySeek: (progress: number) => void;
  /** Cut to a different camera while a replay is playing. */
  onReplayCamera: (mode: AleCameraMode) => void;
  /** End the active replay early. */
  onStopReplay: () => void;
  /** Choose how often KOs/highlights auto-trigger an instant replay. */
  onSetReplayFrequency: (freq: ReplayFrequency) => void;
  /** When false, render only the section bodies (hosted inside the dock shell). */
  chrome?: boolean;
}

export function AdminPanel({
  open,
  characterId,
  weaponId,
  difficulty,
  onCharacter,
  onWeapon,
  onDifficulty,
  onSpawn,
  onSpawnBoss,
  onClearNpcs,
  onClose,
  duel,
  onStartDuel,
  onStopDuel,
  roomPreset,
  backdropId,
  onBackdrop,
  ale,
  onDuelCamera,
  onToggleDiagnostics,
  onStartReplay,
  onReplayPause,
  onReplaySpeed,
  onReplaySeek,
  onReplayCamera,
  onStopReplay,
  onSetReplayFrequency,
  chrome = true,
}: Props) {
  const [spawnFaction, setSpawnFaction] = useState<Faction>("enemy");
  const [dungeonMap, setDungeonMap] = useState<DungeonMapId>(() => loadDungeonMap());
  const [matchMode, setMatchMode] = useState<number>(1);
  if (chrome && !open) return null;
  const body = (
    <>
      <div className="panel-section">
        <h3>
          <Icon name="animator" size={16} /> Character
        </h3>
        <div className="grid2">
          {CHARACTERS.map((c) => (
            <button
              key={c.id}
              className={`opt opt-icon ${c.id === characterId ? "active" : ""}`}
              onClick={() => onCharacter(c.id)}
            >
              <Icon name="anim-test" size={20} />
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="weapon-mesh" size={16} /> Player Weapon
        </h3>
        <div className="grid2">
          {WEAPONS.map((w) => (
            <button
              key={w.id}
              className={`opt opt-icon ${w.id === weaponId ? "active" : ""}`}
              onClick={() => onWeapon(w.id)}
            >
              <Icon name={WEAPON_ICON[w.id]} size={20} />
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="anim-test" size={16} /> Sparring
        </h3>
        <div className="grid2">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              className={`opt ${d.id === difficulty ? "active" : ""}`}
              onClick={() => onDifficulty(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="weapon-mesh" size={16} /> Spawn NPC
        </h3>
        <div className={`grid2 faction-toggle ${spawnFaction}`}>
          {FACTIONS.map((f) => (
            <button
              key={f.id}
              className={`opt opt-faction ${f.id} ${f.id === spawnFaction ? "active" : ""}`}
              onClick={() => setSpawnFaction(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="spar-count-label">
          Click a weapon to spawn an {spawnFaction === "ally" ? "ALLY" : "ENEMY"} fighter
        </p>
        <div className="grid2">
          {WEAPONS.map((w) => (
            <button
              key={w.id}
              className="opt opt-icon"
              onClick={() => onSpawn(w.id, spawnFaction)}
            >
              <Icon name={WEAPON_ICON[w.id]} size={20} />
              {w.label}
            </button>
          ))}
        </div>
        <button className="opt opt-clear" onClick={onClearNpcs}>
          Clear all NPCs
        </button>
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="weapon-mesh" size={16} /> Spawn Boss
        </h3>
        <p className="spar-count-label">
          A heavy boss — its skill swings are unblockable (dodge only)
        </p>
        <div className="grid2">
          {WEAPONS.map((w) => (
            <button
              key={w.id}
              className="opt opt-icon"
              onClick={() => onSpawnBoss(w.id)}
            >
              <Icon name={WEAPON_ICON[w.id]} size={20} />
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="patrol" size={16} /> Test Map
        </h3>
        <p className="spar-count-label">
          The gameplay level loaded behind the Danger Room door. Re-enter the door
          to load a new pick.
        </p>
        <div className="grid2">
          {DUNGEON_MAP_LIST.map((m) => (
            <button
              key={m.id}
              className={`opt ${m.id === dungeonMap ? "active" : ""}`}
              onClick={() => {
                setDungeonMap(m.id);
                saveDungeonMap(m.id);
              }}
              title={m.blurb}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="anim-test" size={16} /> AI Duel
        </h3>
        <p className="spar-count-label">
          AI Explorer teams fight each other; weapon class rotates each round. A
          round ends when one team is fully wiped out.
        </p>
        <div className="ale-row-label">Match Mode</div>
        <div className="grid3">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              className={`opt ${matchMode === n ? "active" : ""}`}
              disabled={!!duel}
              onClick={() => setMatchMode(n)}
            >
              {n}v{n}
            </button>
          ))}
        </div>
        <EnvPreview preset={ROOM_PRESETS[roomPreset]} />
        <div className="ale-row-label">Backdrop</div>
        <div className="grid2">
          <button
            className={`opt ${backdropId === null ? "active" : ""}`}
            onClick={() => onBackdrop(null)}
          >
            None
          </button>
          {BACKDROPS.map((b) => (
            <button
              key={b.id}
              className={`opt ${backdropId === b.id ? "active" : ""}`}
              onClick={() => onBackdrop(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
        {duel ? (
          <>
            <div className="duel-readout">
              <div className="duel-score">
                <span className="duel-fighter duel-a">A {duel.scoreA}</span>
                <span className="duel-vs">vs</span>
                <span className="duel-fighter duel-b">{duel.scoreB} B</span>
              </div>
              <div className="duel-status">
                {duel.teamSize}v{duel.teamSize} · Round {duel.round} · {duel.weaponLabel}
                {duel.phase === "countdown" && ` · Starting in ${duel.timer}…`}
                {duel.phase === "fighting" && " · Fighting"}
                {duel.phase === "result" &&
                  ` · ${
                    duel.lastWinner === "A"
                      ? "Fighter A wins"
                      : duel.lastWinner === "B"
                        ? "Fighter B wins"
                        : "Draw"
                  }`}
              </div>
            </div>
            <button className="opt opt-clear" onClick={onStopDuel}>
              Stop Duel
            </button>
          </>
        ) : (
          <button className="opt" onClick={() => onStartDuel(matchMode)}>
            Start {matchMode}v{matchMode} Duel
          </button>
        )}
      </div>

      <div className="panel-section">
        <h3>
          <Icon name="anim-test" size={16} /> A.L.E. Bot
        </h3>
        <p className="spar-count-label">
          Director cameras, auto highlights & a combat diagnostics lens over the duel.
        </p>

        <div className="ale-row-label">Camera</div>
        <div className="grid3">
          {ALE_CAMS.map((c) => (
            <button
              key={c.id}
              className={`opt ${ale?.cameraMode === c.id ? "active" : ""}`}
              onClick={() => onDuelCamera(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <button
          className={`opt ale-diag ${ale?.diagnostics ? "active" : ""}`}
          onClick={onToggleDiagnostics}
        >
          Diagnostics Lens: {ale?.diagnostics ? "On" : "Off"}
        </button>

        <div className="ale-row-label">Instant Replay</div>
        {ale?.replaying ? (
          <div className="replay-controls">
            <input
              className="replay-scrub"
              type="range"
              min={0}
              max={1000}
              value={Math.round((ale?.replayProgress ?? 0) * 1000)}
              onChange={(e) => onReplaySeek(Number(e.target.value) / 1000)}
              aria-label="Replay scrub bar"
            />
            <div className="replay-btn-row">
              <button
                className="opt"
                onClick={() => onReplayPause(!ale?.replayPaused)}
                title={ale?.replayPaused ? "Play" : "Pause"}
              >
                {ale?.replayPaused ? "▶ Play" : "❚❚ Pause"}
              </button>
              <button className="opt" onClick={onStopReplay} title="Exit replay">
                ✕ Exit
              </button>
            </div>

            <div className="replay-label-row">
              <span className="replay-sub-label">Speed</span>
              <div className="replay-chip-row">
                {REPLAY_SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={`opt replay-chip ${
                      Math.abs((ale?.replaySpeed ?? 0) - s) < 1e-3 ? "active" : ""
                    }`}
                    onClick={() => onReplaySpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            <div className="replay-label-row">
              <span className="replay-sub-label">Camera</span>
              <div className="replay-chip-row">
                {REPLAY_CAMS.map((c) => (
                  <button
                    key={c.id}
                    className={`opt replay-chip ${
                      ale?.replayCamera === c.id ? "active" : ""
                    }`}
                    onClick={() => onReplayCamera(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <button className="opt ale-diag" onClick={onStartReplay} disabled={!ale?.canReplay}>
            Instant Replay
          </button>
        )}
        <div className="ale-row-label">Auto-Replay Frequency</div>
        <div className="grid3">
          {REPLAY_FREQS.map((f) => (
            <button
              key={f.id}
              className={`opt ${(ale?.replayFrequency ?? "highlights") === f.id ? "active" : ""}`}
              onClick={() => onSetReplayFrequency(f.id)}
              title={f.hint}
            >
              {f.label}
            </button>
          ))}
        </div>

        {ale && (
          <div className="ale-meter" title="Live excitement">
            <span>Excitement{ale.slowmo ? " · SLOW-MO" : ""}</span>
            <div className="ale-meter-bar">
              <div
                className="ale-meter-fill"
                style={{ width: `${Math.round(ale.excitement * 100)}%` }}
              />
            </div>
          </div>
        )}

        {ale && ale.highlights.length > 0 && (
          <div className="ale-highlights">
            <div className="ale-row-label">Highlights</div>
            <ul>
              {ale.highlights.slice(0, 6).map((h, i) => (
                <li key={i} className={`ale-hl ale-hl-${h.fighter.toLowerCase()}`}>
                  <span className="ale-hl-t">{h.t.toFixed(1)}s</span>
                  <span className="ale-hl-label">
                    {h.label} · {h.fighter}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {ale?.report && (
          <div className="ale-report">
            <div className="ale-row-label">Post-Duel Report</div>
            <div className="ale-report-meta">
              {ale.report.rounds} round(s)
              {ale.report.timeToKill.length > 0 &&
                ` · avg TTK ${(
                  ale.report.timeToKill.reduce((s, x) => s + x, 0) /
                  ale.report.timeToKill.length
                ).toFixed(1)}s`}
            </div>
            <ul className="ale-findings">
              {ale.report.findings.map((f, i) => (
                <li key={i} className={`ale-finding ale-finding-${f.category}`}>
                  <span className="ale-finding-cat">{f.category}</span>
                  <span className="ale-finding-text">{f.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {ale && ale.feed.length > 0 && (
          <div className="ale-feed">
            <div className="ale-row-label">
              A.L.E. Feed <span className="ale-feed-tag">drafts · not published</span>
            </div>
            <ul className="ale-posts">
              {ale.feed.map((p, i) => (
                <li key={i} className={`ale-post ale-post-${p.platform}`}>
                  <div className="ale-post-head">
                    <span className="ale-post-platform">{PLATFORM_LABEL[p.platform]}</span>
                    <span className="ale-post-hype" title="A.L.E. hype score">
                      {Math.round(p.hype * 100)}
                    </span>
                  </div>
                  {p.headline && <div className="ale-post-headline">{p.headline}</div>}
                  <div className="ale-post-caption">{p.caption}</div>
                  {p.tags.length > 0 && (
                    <div className="ale-post-tags">
                      {p.tags.map((t) => (
                        <span key={t} className="ale-post-tagpill">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    className="opt ale-post-copy"
                    onClick={() => {
                      const text = [p.headline, p.caption, p.tags.map((t) => `#${t}`).join(" ")]
                        .filter(Boolean)
                        .join("\n\n");
                      void navigator.clipboard?.writeText(text);
                    }}
                  >
                    Copy draft
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {ale && ale.log.length > 0 && (
          <div className="ale-reclog">
            <div className="ale-row-label">Fight Recording</div>
            <ul className="ale-loglist">
              {ale.log
                .slice(-40)
                .reverse()
                .map((e, i) => (
                  <li key={i} className={`ale-logrow ale-log-${e.actor} ale-logkind-${e.kind}`}>
                    <span className="ale-log-t">{e.t.toFixed(1)}s</span>
                    <span className="ale-log-actor">{ACTOR_LABEL[e.actor]}</span>
                    <span className="ale-log-text">{e.text}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {ale?.recap && (
          <div className="ale-recap">
            <div className="ale-row-label">Match Recap by A.L.E.</div>
            <div className="ale-recap-title">{ale.recap.title}</div>
            <ul className="ale-recap-lines">
              {ale.recap.lines.map((l, i) => (
                <li key={i} className="ale-recap-line">
                  {l}
                </li>
              ))}
            </ul>
            <div className="ale-recap-skill">
              <span className={ale.recap.skill.cleanTiming ? "ale-skill-ok" : "ale-skill-warn"}>
                {ale.recap.skill.cleanTiming ? "Skill timing: ad-ready" : "Skill timing: not there yet"}
              </span>
              <span className="ale-skill-meta">
                {ale.recap.skill.parries}P · {ale.recap.skill.blocks}B · {ale.recap.skill.dodges}D
              </span>
            </div>
          </div>
        )}

        <AleReviewPlayer
          review={ale?.review ?? null}
          onCamera={onDuelCamera}
          currentCamera={ale?.cameraMode}
        />
      </div>
    </>
  );

  if (!chrome) return body;
  return (
    <div className="panel panel-left">
      <div className="panel-head">
        <h2>
          <Icon name="loadout-card" size={20} className="head-icon" /> Admin
        </h2>
        <button className="x" onClick={onClose}>
          ✕
        </button>
      </div>
      {body}
      <p className="panel-hint">
        Press <kbd>Tab</kbd> to toggle this panel. Allies fight enemies; enemies
        fight you and your allies. Hold <kbd>Ctrl</kbd> to block — a last-moment
        block parries; <kbd>RMB</kbd> toggles hard lock-on.
      </p>
    </div>
  );
}
