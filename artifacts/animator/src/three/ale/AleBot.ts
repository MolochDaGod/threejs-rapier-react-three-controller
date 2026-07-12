import * as THREE from "three";
import type {
  AleActor,
  AleCameraMode,
  AleLogEntry,
  AlePost,
  AleRecap,
  AleReportData,
  AleReview,
  AleSnapshot,
  DuelState,
  FighterView,
  ReplayFrequency,
} from "../types";
import { buildAleFeed } from "./feed";
import { buildAleRecap, buildAleReview } from "./recap";
import { DuelCamera, type CameraFrame } from "./DuelCamera";
import { Diagnostics, type DiagFighter } from "./Diagnostics";
import { DuelDirector, type DuelEvent } from "./director";
import {
  buildAleReport,
  emptyFighterTelemetry,
  type AleTelemetry,
  type FighterTelemetry,
} from "./report";
import { ReplayBuffer, sampleFrames, type ExplorerPose, type ReplayFrame } from "./replay";
import type { ExplorerCharacter } from "../ExplorerCharacter";

type Side = "A" | "B";

/** Per-fighter diff state carried frame to frame to derive telemetry. */
interface Tracked {
  side: Side;
  health: number;
  maxHealth: number;
  state: FighterView["state"];
  pos: THREE.Vector3;
  inAttack: boolean;
  landed: boolean;
  /** Seconds left where the fighter counts as "striking" (just dealt damage). */
  strikeFlash: number;
  /** Previous weapon-tip world position, for swing-speed estimation. */
  prevWeapon: THREE.Vector3 | null;
}

const STRIKE_FLASH = 0.12;
const FORCE_THRESHOLD = 8;
/** Weapon-tip speed (m/s) above which an attack frame is "fast motion". */
const FAST_WEAPON = 6;
const EYE = 1.55;
/** Cap on the rolling fight-recording log (oldest dropped first). */
const LOG_CAP = 240;

/** Human label per fighter side for the recording log. */
const PLAYER: Record<Side, string> = { A: "Player 1", B: "Player 2" };

/** Seconds of recent fight footage kept in the rolling replay buffer. */
const REPLAY_WINDOW = 5;
/** Ring capacity (~8s @ 60fps headroom over the playback window). */
const REPLAY_CAPACITY = 480;
/** Default slow-mo factor recorded footage is re-played at (lower = slower). */
const REPLAY_SPEED = 0.5;
/** Camera modes a viewer can cut to while scrubbing a replay ("off" excluded). */
const REPLAY_CAMERAS: AleCameraMode[] = ["director", "orbit", "povA", "povB"];
/** Delay after a KO before an auto-replay fires, so the finish gets recorded. */
const AUTO_REPLAY_DELAY = 0.7;
/** Delay after a mid-round highlight before its auto-replay fires (records the aftermath). */
const HIGHLIGHT_REPLAY_DELAY = 0.6;
/** Highlight kinds (besides KO) exciting enough to earn a mid-round auto-replay. */
const HIGHLIGHT_REPLAY_KINDS: ReadonlySet<DuelEvent["kind"]> = new Set<DuelEvent["kind"]>([
  "crit",
  "parry",
  "bigHit",
]);
/** Per-frequency pacing for auto-replays. */
interface ReplayProfile {
  /** Whether a finishing KO auto-triggers a replay. */
  ko: boolean;
  /** Excitement (0..1) a mid-round highlight must reach (Infinity = never). */
  excitement: number;
  /** Cooldown (s) after a mid-round replay ends before another can auto-fire. */
  cooldown: number;
}
/**
 * Maps the viewer-chosen replay frequency to concrete thresholds/cooldowns.
 * Higher frequency = lower excitement bar + shorter anti-spam cooldown.
 */
const REPLAY_PROFILES: Record<ReplayFrequency, ReplayProfile> = {
  off: { ko: false, excitement: Infinity, cooldown: 8 },
  ko: { ko: true, excitement: Infinity, cooldown: 8 },
  rare: { ko: true, excitement: 0.92, cooldown: 14 },
  highlights: { ko: true, excitement: 0.8, cooldown: 8 },
  frequent: { ko: true, excitement: 0.6, cooldown: 4 },
};
/** Default pacing when a duel first starts (matches the legacy auto-replay feel). */
const DEFAULT_REPLAY_FREQUENCY: ReplayFrequency = "highlights";

/**
 * A.L.E. Bot — the "Automated League Evaluator". A director/cameras/highlights/
 * diagnostics layer over the AI duels. It polls fighter state each frame (no
 * combat-internal edits), drives a decoupled camera rig, runs the diagnostics
 * lens, and accumulates telemetry into a ranked post-duel report.
 */
export class AleBot {
  private readonly camera = new DuelCamera();
  private readonly director = new DuelDirector();
  readonly diagnostics = new Diagnostics();

  private active = false;
  private cameraMode: AleCameraMode = "off";
  private readonly tracked = new Map<number, Tracked>();
  private a: FighterTelemetry = emptyFighterTelemetry();
  private b: FighterTelemetry = emptyFighterTelemetry();
  private timeToKill: number[] = [];
  private rounds = 1;
  private elapsed = 0;
  private roundStartT = 0;
  private prevPhase: DuelState["phase"] = "idle";
  /** True once the current round's time-to-kill has been recorded (one per KO). */
  private roundTimed = false;
  private report: AleReportData | null = null;
  private feed: AlePost[] = [];
  /** Rolling, attributed fight recording (Player 1 / Player 2 / A.L.E.). */
  private log: AleLogEntry[] = [];
  private recap: AleRecap | null = null;
  private review: AleReview | null = null;
  /** Slow-mo edge-detect, so it logs once per trigger. */
  private prevSlowmo = false;

  private readonly aPos = new THREE.Vector3();
  private readonly bPos = new THREE.Vector3();
  private readonly aHead = new THREE.Vector3();
  private readonly bHead = new THREE.Vector3();
  private readonly frame: CameraFrame = {
    aPos: this.aPos,
    bPos: this.bPos,
    aHead: this.aHead,
    bHead: this.bHead,
    hotspot: new THREE.Vector3(),
    intensity: 0,
  };

  // ── Instant replay state ──
  /** Rolling buffer of recorded per-frame fighter poses (duel-only). */
  private readonly replay = new ReplayBuffer(REPLAY_CAPACITY);
  /** Live avatars by side, cached each frame so a replay can capture/restore. */
  private lastA: ExplorerCharacter | null = null;
  private lastB: ExplorerCharacter | null = null;
  private replaying = false;
  /** Chronological snapshot of frames being played (stable while replaying). */
  private replayFrames: ReplayFrame[] = [];
  private replayTime = 0;
  private replayStartT = 0;
  private replayEndT = 0;
  /** Viewer-controlled scrub: paused holds the current frame (time frozen). */
  private replayPaused = false;
  /** Viewer-controlled playback rate (1 = recorded real-time, lower = slower). */
  private replaySpeed = REPLAY_SPEED;
  /** Live poses captured at replay start, restored verbatim when it ends. */
  private liveA: ExplorerPose | null = null;
  private liveB: ExplorerPose | null = null;
  private replayLiveCaptured = false;
  /** Camera mode to restore after a replay forces a cinematic framing. */
  private replayPrevMode: AleCameraMode = "off";
  /** How often KOs/highlights auto-trigger a replay, and the countdown to one. */
  private replayFrequency: ReplayFrequency = DEFAULT_REPLAY_FREQUENCY;
  private autoReplayPending = 0;
  /** Anti-spam cooldown after a mid-round replay before another can auto-fire. */
  private replayCooldown = 0;

  /** Scene group for the diagnostics overlay (host adds/removes it). */
  get overlay(): THREE.Group {
    return this.diagnostics.group;
  }

  /** True while an instant replay is driving the fighters + camera. */
  get isReplaying(): boolean {
    return this.replaying;
  }

  onDuelStart(state: DuelState | null): void {
    this.active = true;
    this.tracked.clear();
    this.a = emptyFighterTelemetry();
    this.b = emptyFighterTelemetry();
    this.timeToKill = [];
    this.rounds = state?.round ?? 1;
    this.prevPhase = state?.phase ?? "idle";
    this.roundTimed = false;
    this.elapsed = 0;
    this.roundStartT = 0;
    this.report = null;
    this.feed = [];
    this.log = [];
    this.recap = null;
    this.review = null;
    this.prevSlowmo = false;
    this.director.reset();
    // A fresh duel starts with an empty replay buffer + no pending playback.
    this.replay.clear();
    this.replaying = false;
    this.replayLiveCaptured = false;
    this.autoReplayPending = 0;
    this.replayCooldown = 0;
    this.lastA = null;
    this.lastB = null;
    // Default to the director drone so a fresh duel is immediately watchable.
    if (this.cameraMode === "off") this.cameraMode = "director";
    this.camera.setMode(this.cameraMode);
  }

  onDuelStop(): void {
    if (this.active) {
      this.report = this.buildReport();
      const hl = this.director.getHighlights();
      // A.L.E. drafts its attention-grabbing posts + broadcast package from the duel.
      this.feed = buildAleFeed(this.report, hl);
      this.recap = buildAleRecap(this.report, hl);
      this.review = buildAleReview(this.report, hl);
    }
    this.active = false;
    // Abandon any in-flight replay — fighters are about to be cleared.
    this.replaying = false;
    this.replayLiveCaptured = false;
    this.autoReplayPending = 0;
    this.replayCooldown = 0;
    this.replay.clear();
  }

  setCameraMode(mode: AleCameraMode): void {
    this.cameraMode = mode;
    this.camera.setMode(mode);
  }

  toggleDiagnostics(on?: boolean): boolean {
    const next = on ?? !this.diagnostics.isVisible();
    this.diagnostics.setVisible(next);
    return next;
  }

  /** Whether a duel camera is currently driving the view (vs. the player cam). */
  get cameraActive(): boolean {
    return this.active && this.cameraMode !== "off";
  }

  /** Global slow-mo time-scale to apply this frame (1 = normal speed). */
  timeScale(): number {
    return this.active ? this.director.timeScale() : 1;
  }

  /**
   * Advance one duel frame.
   * @param dt    slow-mo-scaled delta (matches what the engine stepped).
   * @param views fighterViews() from the duel's Targets.
   * @param state current duel state (round number).
   */
  update(dt: number, views: FighterView[], state: DuelState | null): void {
    if (!this.active) return;
    this.elapsed += dt;
    if (state) {
      this.rounds = Math.max(this.rounds, state.round);
      // Time-to-kill is measured from the moment fighting actually begins
      // (after the countdown), so the countdown never inflates the timing.
      if (state.phase === "fighting" && this.prevPhase !== "fighting") {
        this.roundStartT = this.elapsed;
        this.roundTimed = false;
        this.logEvent("ale", "round", `Round ${state.round} \u2014 fight!`);
      }
      this.prevPhase = state.phase;
    }

    const events: DuelEvent[] = [];
    const diagFighters: DiagFighter[] = [];
    const seen = new Set<number>();
    let aSeen = false;
    let bSeen = false;

    for (const v of views) {
      seen.add(v.id);
      const side: Side = v.faction === "ally" ? "A" : "B";
      const mine = side === "A" ? this.a : this.b;
      const foe = side === "A" ? this.b : this.a;
      const pos = v.group.position;
      let t = this.tracked.get(v.id);
      if (!t) {
        t = {
          side,
          health: v.health,
          maxHealth: v.maxHealth,
          state: v.state,
          pos: pos.clone(),
          inAttack: false,
          landed: false,
          strikeFlash: 0,
          prevWeapon: null,
        };
        this.tracked.set(v.id, t);
      }

      // ── Damage taken → credit a hit to the opponent ──
      const dmg = t.health - v.health;
      if (dmg > 0.001) {
        foe.hits += 1;
        foe.damageDealt += dmg;
        // Attribute the landed hit to the single live opposing fighter.
        const attacker = this.findOpponent(side);
        if (attacker) {
          attacker.landed = true;
          attacker.strikeFlash = STRIKE_FLASH;
        }
        // Knockback force estimate from this fighter's displacement.
        const force = t.pos.distanceTo(pos) / Math.max(dt, 1e-3);
        if (force > FORCE_THRESHOLD) {
          foe.forceSpikes += 1;
          foe.peakForce = Math.max(foe.peakForce, force);
        }
        const big = dmg >= v.maxHealth * 0.18;
        const atkSide: Side = side === "A" ? "B" : "A";
        this.logEvent(
          atkSide,
          big ? "crit" : "hit",
          `${PLAYER[atkSide]} ${big ? "lands a CRIT" : "connects"} on ${PLAYER[side]} (${Math.round(dmg)})`,
        );
        events.push({
          fighter: side === "A" ? "B" : "A",
          kind: big ? "crit" : "bigHit",
          at: this.midpoint(pos),
          magnitude: dmg,
        });
      }

      // ── State-transition driven counters ──
      if (t.state !== v.state) {
        if (v.state === "attack") {
          mine.swings += 1;
          t.inAttack = true;
          t.landed = false;
        } else if (t.state === "attack") {
          if (!t.landed) mine.whiffs += 1;
          t.inAttack = false;
        }
        if (v.state === "block") {
          mine.blocks += 1;
          this.logEvent(side, "block", `${PLAYER[side]} blocks`);
        }
        if (v.state === "dodge") {
          mine.dodges += 1;
          this.logEvent(side, "dodge", `${PLAYER[side]} dodges`);
        }
        if (v.state === "parry") {
          mine.parries += 1;
          this.logEvent(side, "parry", `${PLAYER[side]} PARRIES \u2014 clean read`);
          events.push({ fighter: side, kind: "parry", at: this.midpoint(pos), magnitude: 1 });
        }
        if (v.state === "dead") {
          foe.kos += 1;
          const winSide: Side = side === "A" ? "B" : "A";
          this.logEvent(winSide, "ko", `${PLAYER[winSide]} KO \u2014 ${PLAYER[side]} is down`);
          // One timing sample per round, closed on the KO that ends it.
          if (!this.roundTimed) {
            this.timeToKill.push(Math.max(0, this.elapsed - this.roundStartT));
            this.roundTimed = true;
          }
          events.push({
            fighter: side === "A" ? "B" : "A",
            kind: "ko",
            at: this.midpoint(pos),
            magnitude: 2,
          });
        }
      }

      if (t.strikeFlash > 0) t.strikeFlash = Math.max(0, t.strikeFlash - dt);

      // ── Markers + missing-collider detection (runs even with lens hidden) ──
      const markers = v.avatar?.getMarkers() ?? null;
      let flagged = false;
      if (markers) {
        let weaponSpeed = 0;
        if (t.prevWeapon && dt > 1e-4) {
          weaponSpeed = t.prevWeapon.distanceTo(markers.weapon) / dt;
        }
        if (!t.prevWeapon) t.prevWeapon = new THREE.Vector3();
        t.prevWeapon.copy(markers.weapon);
        // Fast weapon motion mid-attack that never landed = a swing the combat
        // model resolved by distance, not a real swept collider.
        flagged = v.state === "attack" && t.strikeFlash <= 0 && weaponSpeed > FAST_WEAPON;
        if (flagged) mine.missingColliderFlags += 1;
        diagFighters.push({ id: v.id, markers, striking: t.strikeFlash > 0, flagged });
      }

      // Cache camera anchors + the live avatar per side (avatar drives replay).
      const avatar = (v.avatar as ExplorerCharacter | null) ?? null;
      if (side === "A") {
        aSeen = true;
        this.aPos.copy(pos);
        this.aHead.copy(markers?.head ?? this.tmpHead(pos));
        this.lastA = avatar;
      } else {
        bSeen = true;
        this.bPos.copy(pos);
        this.bHead.copy(markers?.head ?? this.tmpHead(pos));
        this.lastB = avatar;
      }

      // Commit diff state.
      t.state = v.state;
      t.health = v.health;
      t.maxHealth = v.maxHealth;
      t.pos.copy(pos);
    }

    // Drop tracking for fighters that despawned (respawns get fresh ids).
    for (const id of this.tracked.keys()) {
      if (!seen.has(id)) this.tracked.delete(id);
    }

    // Diagnostics visuals only when the lens is on (no allocations otherwise).
    if (this.diagnostics.isVisible()) this.diagnostics.update(diagFighters);

    // Director: proximity + events drive excitement, hotspot & slow-mo.
    const bothAlive = aSeen && bSeen;
    const dist = bothAlive ? this.aPos.distanceTo(this.bPos) : 99;
    const proximity = bothAlive ? THREE.MathUtils.clamp(1 - (dist - 1) / 4, 0, 1) : 0;
    const mid = new THREE.Vector3().copy(this.aPos).add(this.bPos).multiplyScalar(0.5);
    this.director.update(dt, proximity, events, this.rounds, mid);

    // Slow-mo rising edge → A.L.E. calls it once.
    const slowmoNow = this.director.isSlowmo();
    if (slowmoNow && !this.prevSlowmo) {
      this.logEvent("ale", "slowmo", "Slow-mo \u2014 watch this one again.");
    }
    this.prevSlowmo = slowmoNow;

    // Drive the camera rig.
    this.frame.hotspot.copy(this.director.getHotspot());
    this.frame.intensity = this.director.getExcitement();
    this.camera.update(dt, this.frame);

    // ── Rolling replay capture ──
    // Record the live fighter poses while the fight (or its immediate aftermath)
    // is on, so an instant replay can re-pose the real recorded frames.
    const phase = state?.phase;
    if (phase === "fighting" || phase === "result") {
      this.replay.record(this.elapsed, this.lastA, this.lastB);
    }

    // ── Auto-replay on a KO or a high-excitement mid-round highlight ──
    if (this.replayCooldown > 0) this.replayCooldown = Math.max(0, this.replayCooldown - dt);
    const profile = REPLAY_PROFILES[this.replayFrequency];
    if (this.replayFrequency !== "off" && !this.replaying) {
      // Only arm a fresh trigger when none is already pending.
      if (this.autoReplayPending <= 0) {
        if (profile.ko && events.some((e) => e.kind === "ko")) {
          // The finish always earns a replay, cooldown or not.
          this.autoReplayPending = AUTO_REPLAY_DELAY;
        } else if (
          this.replayCooldown <= 0 &&
          this.director.getExcitement() >= profile.excitement &&
          events.some((e) => HIGHLIGHT_REPLAY_KINDS.has(e.kind))
        ) {
          // A crit/parry/big hit that spiked excitement gets the broadcast treatment.
          this.autoReplayPending = HIGHLIGHT_REPLAY_DELAY;
        }
      }
      if (this.autoReplayPending > 0) {
        this.autoReplayPending -= dt;
        if (this.autoReplayPending <= 0) this.startReplay();
      }
    }
  }

  /**
   * Advance one instant-replay frame: re-pose the live fighters from the
   * recorded buffer in slow-mo and frame them from the chosen camera. This runs
   * decoupled from live combat — the host freezes the duel while it's active.
   */
  updateReplay(dt: number, views: FighterView[]): void {
    if (!this.replaying) return;
    let aAv: ExplorerCharacter | null = null;
    let bAv: ExplorerCharacter | null = null;
    for (const v of views) {
      const av = (v.avatar as ExplorerCharacter | null) ?? null;
      if (v.faction === "ally") aAv = av;
      else bAv = av;
    }

    // On the first replay frame, snapshot the live poses for exact restoration
    // and force a cinematic camera if the user was on the free/player view.
    if (!this.replayLiveCaptured) {
      this.liveA = aAv ? aAv.capturePose() : null;
      this.liveB = bAv ? bAv.capturePose() : null;
      this.replayPrevMode = this.camera.getMode();
      if (this.replayPrevMode === "off") this.camera.setMode("director");
      this.replayLiveCaptured = true;
    }

    // Paused holds the current frame: we still re-pose + drive the camera each
    // frame (so live camera switches glide) but never advance the playhead.
    if (!this.replayPaused) {
      this.replayTime += dt * this.replaySpeed;
      if (this.replayTime >= this.replayEndT) {
        this.finishReplay(aAv, bAv);
        return;
      }
    }

    const s = sampleFrames(this.replayFrames, this.replayTime);
    if (!s) {
      this.finishReplay(aAv, bAv);
      return;
    }
    this.applyReplayPose(aAv, s.f0.a, s.f1.a, s.alpha);
    this.applyReplayPose(bAv, s.f0.b, s.f1.b, s.alpha);

    // Frame the recorded action from the chosen camera (recorded roots → heads).
    const hasA = this.replayPos(s.f0.a, s.f1.a, s.alpha, this.aPos);
    const hasB = this.replayPos(s.f0.b, s.f1.b, s.alpha, this.bPos);
    if (hasA && !hasB) this.bPos.copy(this.aPos);
    if (hasB && !hasA) this.aPos.copy(this.bPos);
    this.aHead.set(this.aPos.x, this.aPos.y + EYE, this.aPos.z);
    this.bHead.set(this.bPos.x, this.bPos.y + EYE, this.bPos.z);
    this.frame.hotspot.copy(this.aPos).add(this.bPos).multiplyScalar(0.5);
    this.frame.hotspot.y += 1;
    this.frame.intensity = 0.85;
    this.camera.update(dt, this.frame);
  }

  /** Re-pose one side from a bracketing frame pair (interp when both present). */
  private applyReplayPose(
    av: ExplorerCharacter | null,
    p0: ExplorerPose | null,
    p1: ExplorerPose | null,
    alpha: number,
  ): void {
    if (!av) return;
    if (p0 && p1) av.applyPoseLerp(p0, p1, alpha);
    else if (p0) av.applyPose(p0);
    else if (p1) av.applyPose(p1);
  }

  /** Interpolate a side's recorded root position into `out`; false if absent. */
  private replayPos(
    p0: ExplorerPose | null,
    p1: ExplorerPose | null,
    alpha: number,
    out: THREE.Vector3,
  ): boolean {
    if (p0 && p1) {
      out.set(
        p0.px + (p1.px - p0.px) * alpha,
        p0.py + (p1.py - p0.py) * alpha,
        p0.pz + (p1.pz - p0.pz) * alpha,
      );
      return true;
    }
    const p = p0 ?? p1;
    if (!p) return false;
    out.set(p.px, p.py, p.pz);
    return true;
  }

  /** End the replay: restore the exact live poses + camera, resume live combat. */
  private finishReplay(aAv: ExplorerCharacter | null, bAv: ExplorerCharacter | null): void {
    if (this.liveA && aAv) aAv.applyPose(this.liveA);
    if (this.liveB && bAv) bAv.applyPose(this.liveB);
    this.camera.setMode(this.replayPrevMode);
    this.replaying = false;
    this.replayLiveCaptured = false;
    this.liveA = null;
    this.liveB = null;
    this.replayFrames = [];
    // Hold off further auto-replays so back-to-back exchanges don't spam them.
    this.replayCooldown = REPLAY_PROFILES[this.replayFrequency].cooldown;
  }

  /**
   * Start an instant replay of the last `seconds` of recorded footage. Live
   * poses are captured (and the camera forced) lazily on the first replay frame,
   * so this is safe to call from the host loop or a UI button. Returns false if
   * there isn't enough footage / no duel is running.
   */
  startReplay(seconds = REPLAY_WINDOW): boolean {
    if (!this.active || this.replaying) return false;
    const frames = this.replay.ordered();
    if (frames.length < 2) return false;
    const latest = frames[frames.length - 1].t;
    this.replayFrames = frames;
    this.replayStartT = Math.max(frames[0].t, latest - seconds);
    this.replayEndT = latest;
    this.replayTime = this.replayStartT;
    this.replayLiveCaptured = false;
    this.replayPaused = false;
    this.autoReplayPending = 0;
    this.replaying = true;
    return true;
  }

  /** Pause/resume the active replay's playhead (no-op when not replaying). */
  setReplayPaused(paused: boolean): void {
    this.replayPaused = paused;
  }

  /** Toggle pause on the active replay; returns the new paused state. */
  toggleReplayPaused(): boolean {
    this.replayPaused = !this.replayPaused;
    return this.replayPaused;
  }

  /** Set the replay playback rate (clamped). 1 = recorded real-time. */
  setReplaySpeed(speed: number): void {
    this.replaySpeed = THREE.MathUtils.clamp(speed, 0.1, 2);
  }

  /**
   * Scrub the playhead to a normalised position (0 = window start, 1 = end)
   * within the buffered window. No-op when not replaying.
   */
  seekReplay(progress: number): void {
    if (!this.replaying) return;
    const span = this.replayEndT - this.replayStartT;
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    // Keep a hair short of the end so seeking to 100% doesn't end the replay.
    this.replayTime = this.replayStartT + span * Math.min(p, 0.9995);
  }

  /** Cut to a different camera while a replay is playing (no-op when not). */
  setReplayCamera(mode: AleCameraMode): void {
    if (!this.replaying) return;
    if (mode === "off") return;
    this.camera.setMode(mode);
  }

  /** End the active replay early, restoring live poses + camera. */
  stopReplay(): void {
    if (!this.replaying) return;
    this.finishReplay(this.lastA, this.lastB);
  }

  /** Choose how often KOs/highlights auto-trigger an instant replay. */
  setReplayFrequency(freq: ReplayFrequency): void {
    this.replayFrequency = freq;
    if (freq === "off") this.autoReplayPending = 0;
  }

  /** Write the active duel/replay camera into the live camera (no-op when off). */
  applyCamera(camera: THREE.PerspectiveCamera): void {
    if (!this.cameraActive && !this.replaying) return;
    this.camera.applyTo(camera);
  }

  snapshot(): AleSnapshot {
    const span = this.replayEndT - this.replayStartT;
    return {
      cameraMode: this.cameraMode,
      diagnostics: this.diagnostics.isVisible(),
      excitement: this.director.getExcitement(),
      slowmo: this.active && this.director.isSlowmo(),
      highlights: this.director.getHighlights(),
      report: this.report,
      feed: this.feed,
      log: this.log.slice(),
      recap: this.recap,
      review: this.review,
      replaying: this.replaying,
      replayProgress:
        this.replaying && span > 1e-6
          ? THREE.MathUtils.clamp((this.replayTime - this.replayStartT) / span, 0, 1)
          : 0,
      replayPaused: this.replaying && this.replayPaused,
      replaySpeed: this.replaySpeed,
      replayCamera: this.replaying ? this.camera.getMode() : this.cameraMode,
      replayCameras: REPLAY_CAMERAS,
      replayFrequency: this.replayFrequency,
      canReplay: this.active && this.replay.length >= 2,
    };
  }

  /** Append a timestamped entry to the rolling fight-recording log. */
  private logEvent(actor: AleActor, kind: AleLogEntry["kind"], text: string): void {
    this.log.push({ t: this.elapsed, round: this.rounds, actor, kind, text });
    if (this.log.length > LOG_CAP) this.log.shift();
  }

  private buildReport(): AleReportData {
    const tel: AleTelemetry = {
      rounds: this.rounds,
      timeToKill: this.timeToKill,
      a: this.a,
      b: this.b,
    };
    return buildAleReport(tel);
  }

  /** The live (non-dead) fighter on the opposite side, i.e. the attacker. */
  private findOpponent(victimSide: Side): Tracked | null {
    for (const t of this.tracked.values()) {
      if (t.side !== victimSide && t.state !== "dead") return t;
    }
    return null;
  }

  private tmpHead(pos: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(pos.x, pos.y + EYE, pos.z);
  }

  private midpoint(pos: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(pos.x, pos.y + 1.0, pos.z);
  }

  dispose(): void {
    this.camera.dispose();
    this.diagnostics.dispose();
    this.tracked.clear();
    this.replay.clear();
    this.replaying = false;
    this.replayFrames = [];
    this.liveA = null;
    this.liveB = null;
    this.lastA = null;
    this.lastB = null;
  }
}
