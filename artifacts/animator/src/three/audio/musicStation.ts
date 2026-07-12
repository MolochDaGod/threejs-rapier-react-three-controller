import * as THREE from "three";
import type { DjStationSettings, DjTransition } from "../djStationSettings";

/**
 * A snapshot of the live music used to drive diegetic actors (the resident DJ)
 * so their motion reads as synced to the actual soundtrack rather than a private
 * timer. `intensity` is the smoothed loudness (0 calm .. 1 peak), `beat` is a
 * monotonic bass-onset counter, and `beatPhase` is how far through the current
 * beat we are (0 at each onset .. 1 just before the next).
 */
export interface MusicPulse {
  intensity: number;
  beat: number;
  beatPhase: number;
}

/** Music level base — level 1.0 reproduces the original soft "under the action" mix. */
const MUSIC_BASE = 0.12;
/**
 * The station is a foreground live set (real tracks), so it multiplies up to a
 * clearly audible level while still riding the music/master sliders + mute.
 */
const STATION_GAIN = 5;

/** Wide-open lowpass cutoff (Hz) — the filter is transparent here. */
const FILTER_OPEN = 20000;
/** "Filtered out" cutoff (Hz) — muffled, DJ-style low-end-only. */
const FILTER_CLOSED = 320;
/** Quick blend length (s) for user-driven skips (prev/next/select/reset). */
const MANUAL_FADE = 0.5;

/**
 * The mute-gain node's value from the two INDEPENDENT mute flags: the global
 * mixer mute and the station's own mute button. Either one silences the music;
 * clearing one must never un-silence the other (pure + unit-tested).
 */
export function combinedMuteGain(globalMuted: boolean, stationMuted: boolean): number {
  return globalMuted || stationMuted ? 0 : 1;
}

/** Default config until {@link MusicStation.configure} is called by the app. */
const DEFAULT_CONFIG: DjStationSettings = {
  autoMix: true,
  transition: "crossfade",
  crossfadeSec: 6,
  shuffle: false,
  randomStart: true,
};

/** One audio "deck" — a media element and its per-deck mix nodes. */
interface Deck {
  el: HTMLAudioElement;
  src: MediaElementAudioSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  /** Echo send into the shared delay line (0 = dry, ramped up for "echo out"). */
  send: GainNode;
}

/**
 * Persistent, app-level music player (the "CPT RAC Station"). It owns TWO
 * streaming decks wired into THREE's global {@link AudioContext} so it survives
 * every page/mode switch — the per-mode {@link CombatSfx} engine is torn down and
 * rebuilt on navigation, but this station keeps playing without resetting the
 * track, position, or beat.
 *
 * Two decks let it AUTO-MIX: as one track nears its end the next is cued on the
 * idle deck and the pair are crossfaded (optionally with a filter sweep or echo
 * tail), so songs blend instead of hard-cutting. It also starts on a random
 * track each fresh start (configurable) and supports shuffle / prev / skip /
 * reset from the UI.
 *
 * Routing (per deck): el → src → filter → deckGain → mixBus. A shared delay line
 * (fed by each deck's `send`) provides the "echo out" tail. The mix bus then runs
 * → analyser (beat pulse) → stationGain → levelGain (mixer) → muteGain →
 * destination. Loudness rides the music/master mixer levels and is hard-zeroed by
 * mute, mirroring the rest of the mixer.
 */
class MusicStation {
  private ctx: AudioContext | null = null;
  private decks: Deck[] = [];
  private mixBus: GainNode | null = null;
  private delay: DelayNode | null = null;
  private analyser: AnalyserNode | null = null;
  private stationGain: GainNode | null = null;
  private levelGain: GainNode | null = null;
  private muteGain: GainNode | null = null;
  private freq: Uint8Array<ArrayBuffer> | null = null;

  private tracks: string[] = [];
  private titles: string[] = [];
  private index = 0;
  /** Which deck is currently the foreground/active one (0 or 1). */
  private active = 0;
  /** True while a crossfade is in flight (guards against overlapping mixes). */
  private crossfading = false;
  /** Handle for the in-flight crossfade finalize timer (so it can be cancelled). */
  private fadeTimer: number | null = null;
  /** Set once the set has genuinely started, so re-asserts don't re-randomise. */
  private started = false;
  private enabled = false;
  private muted = false;
  /** User pressed the station's own Pause button (distinct from mixer mute). */
  private userPaused = false;
  /** User pressed the station's own Mute button (independent of mixer mute). */
  private stationMuted = false;
  /** User-facing station name for the now-playing readout. */
  private stationName = "CPT RAC Station";
  private levelMusic = 1;
  private levelMaster = 1;
  private config: DjStationSettings = { ...DEFAULT_CONFIG };
  private onTrack: ((title: string, index: number) => void) | null = null;

  // ---- beat/pulse detection state (adaptive bass-onset) ----
  private intensity = 0;
  private beat = 0;
  private energyAvg = 0;
  private lastOnset = 0;
  private beatPeriod = 0.5;
  private lastPulseT = 0;

  /** Get (lazily create) THREE's shared AudioContext — the same one listeners use. */
  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = THREE.AudioContext.getContext() as unknown as AudioContext;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Build one deck (media element + filter + gain + echo send) into the mix bus. */
  private makeDeck(ctx: AudioContext, mixBus: GainNode, delay: DelayNode): Deck {
    const el = new Audio();
    el.preload = "auto";
    el.loop = false;
    el.crossOrigin = "anonymous";
    const src = ctx.createMediaElementSource(el);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = FILTER_OPEN;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const send = ctx.createGain();
    send.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(mixBus);
    gain.connect(send);
    send.connect(delay);
    const deck: Deck = { el, src, filter, gain, send };
    el.addEventListener("ended", () => this.onDeckEnded(deck));
    el.addEventListener("timeupdate", () => this.onDeckTime(deck));
    return deck;
  }

  /** Lazily build the streaming graph (two decks + delay + mixer). */
  private ensureGraph(): boolean {
    if (this.decks.length > 0) return true;
    const ctx = this.context();
    if (!ctx) return false;
    try {
      const mixBus = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      const stationGain = ctx.createGain();
      stationGain.gain.value = STATION_GAIN;
      const levelGain = ctx.createGain();
      levelGain.gain.value = MUSIC_BASE * this.levelMusic * this.levelMaster;
      const muteGain = ctx.createGain();
      muteGain.gain.value = combinedMuteGain(this.muted, this.stationMuted);

      // Shared echo/delay line feeding the mix (for the "echo out" transition).
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.28;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.4;
      const delayWet = ctx.createGain();
      delayWet.gain.value = 1;
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(delayWet);
      delayWet.connect(mixBus);

      mixBus.connect(analyser);
      analyser.connect(stationGain);
      stationGain.connect(levelGain);
      levelGain.connect(muteGain);
      muteGain.connect(ctx.destination);

      this.mixBus = mixBus;
      this.delay = delay;
      this.analyser = analyser;
      this.stationGain = stationGain;
      this.levelGain = levelGain;
      this.muteGain = muteGain;
      this.freq = new Uint8Array(analyser.frequencyBinCount);
      this.decks = [this.makeDeck(ctx, mixBus, delay), this.makeDeck(ctx, mixBus, delay)];
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Apply station behaviour settings (auto-mix, transition style, crossfade
   * length, shuffle, random-start). Safe to call any time; changes take effect on
   * the next transition. Call this BEFORE the first {@link setPlaylist} so the
   * random-start choice is honoured on the opening track.
   */
  configure(cfg: Partial<DjStationSettings>): void {
    this.config = { ...this.config, ...cfg };
  }

  /**
   * Set the playlist and start (or keep) playing. Idempotent: if the same track
   * list is already loaded it does NOT reload/restart — that is what keeps the
   * music from resetting when a caller (e.g. a freshly-built Studio) re-asserts
   * the playlist on every mode switch. Pass an empty list to stop.
   */
  setPlaylist(urls: string[], titles: string[] = []): void {
    const same =
      urls.length === this.tracks.length && urls.every((u, i) => u === this.tracks[i]);
    this.tracks = urls.slice();
    this.titles = titles.slice();
    if (urls.length === 0) {
      this.enabled = false;
      if (this.fadeTimer !== null) {
        window.clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
      }
      this.crossfading = false;
      this.decks.forEach((d) => d.el.pause());
      return;
    }
    // Already playing this set with a live graph — leave it be. The decks guard
    // means a prior failed graph build can still retry on a re-assert instead of
    // being short-circuited forever.
    if (same && this.enabled && this.decks.length > 0) return;
    this.enabled = true;
    if (!this.ensureGraph()) return;
    // Switching to a DIFFERENT set: cancel any in-flight crossfade so its stale
    // finalize timer can't pause the deck the new set is about to play on.
    if (this.fadeTimer !== null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.crossfading = false;
    this.userPaused = false;
    // Genuine (re)start: pick the opening track (random if configured), cue it on
    // the active deck at full gain, silence the other.
    if (!this.started && this.config.randomStart && this.tracks.length > 1) {
      this.index = Math.floor(Math.random() * this.tracks.length);
    } else if (this.index >= this.tracks.length) {
      this.index = 0;
    }
    this.started = true;
    this.startActive();
  }

  /** Cue the current index on the active deck at full gain and play it. */
  private startActive(): void {
    const deck = this.decks[this.active];
    if (!deck) return;
    this.decks.forEach((d, i) => {
      d.gain.gain.value = i === this.active ? 1 : 0;
      d.filter.frequency.value = FILTER_OPEN;
      d.send.gain.value = 0;
      if (i !== this.active) d.el.pause();
    });
    this.cueDeck(deck, this.index);
    this.playDeck(deck);
    this.onTrack?.(this.titles[this.index] ?? "", this.index);
  }

  /** Resume the audio context + (re)start playback (call from a user gesture). */
  resume(): void {
    const ctx = this.context();
    if (ctx && (ctx.state === "suspended" || (ctx.state as string) === "interrupted")) {
      void ctx.resume();
    }
    const deck = this.decks[this.active];
    if (this.enabled && !this.userPaused && deck?.el.paused) this.playDeck(deck);
  }

  /** User-facing pause: halt playback but keep the track + position. */
  pause(): void {
    this.userPaused = true;
    this.decks.forEach((d) => d.el.pause());
  }

  /** User-facing play: resume the active deck where it left off. */
  play(): void {
    this.userPaused = false;
    const deck = this.decks[this.active];
    if (this.enabled && deck?.el.paused) this.playDeck(deck);
  }

  /** Whether the user has paused the station via {@link pause}. */
  isPaused(): boolean {
    return this.userPaused;
  }

  /** Station-level mute (independent of the global mixer mute). */
  setStationMuted(muted: boolean): void {
    this.stationMuted = muted;
    if (this.muteGain) this.muteGain.gain.value = combinedMuteGain(this.muted, this.stationMuted);
  }

  /** Whether the station's own mute is engaged. */
  isStationMuted(): boolean {
    return this.stationMuted;
  }

  /** Set the user-facing station name shown in the now-playing readout. */
  setStationName(name: string): void {
    this.stationName = name;
  }

  /** Register a callback fired whenever the cued/foreground track changes. */
  setOnTrack(cb: ((title: string, index: number) => void) | null): void {
    this.onTrack = cb;
  }

  /** The currently-foreground track's title + index (for a now-playing readout). */
  getInfo(): { name: string; title: string; index: number; count: number } | null {
    if (!this.enabled || this.tracks.length === 0) return null;
    return {
      name: this.stationName,
      title: this.titles[this.index] ?? "",
      index: this.index,
      count: this.tracks.length,
    };
  }

  /** All track titles in playlist order (for the station's track list UI). */
  getTitles(): string[] {
    return this.titles.slice();
  }

  /** Pick the next track index, honouring shuffle (never repeats immediately). */
  private pickNext(): number {
    const n = this.tracks.length;
    if (n <= 1) return this.index;
    if (this.config.shuffle) {
      let j = this.index;
      while (j === this.index) j = Math.floor(Math.random() * n);
      return j;
    }
    return (this.index + 1) % n;
  }

  /** Skip to the next track (quick blend). */
  next(): void {
    if (!this.enabled || this.tracks.length === 0) return;
    this.transitionTo(this.pickNext(), MANUAL_FADE, "crossfade");
  }

  /**
   * DJ-mix into the next track NOW, using the configured auto-mix transition
   * style + crossfade length (vs {@link next}'s quick utility blend).
   */
  mixNext(): void {
    if (!this.enabled || this.tracks.length === 0) return;
    const style = this.config.transition;
    const sec = style === "cut" ? 0.05 : this.config.crossfadeSec;
    this.transitionTo(this.pickNext(), sec, style);
  }

  /** Skip to the previous track (quick blend). */
  prev(): void {
    if (!this.enabled || this.tracks.length === 0) return;
    const n = this.tracks.length;
    this.transitionTo((this.index - 1 + n) % n, MANUAL_FADE, "crossfade");
  }

  /** Jump directly to a specific track (quick blend). */
  playAt(i: number): void {
    if (!this.enabled || this.tracks.length === 0) return;
    const n = this.tracks.length;
    const idx = ((i % n) + n) % n;
    if (idx === this.index && !this.crossfading) return;
    this.transitionTo(idx, MANUAL_FADE, "crossfade");
  }

  /** Restart the station on a fresh random track (the "re-roll" reset). */
  reset(): void {
    if (!this.enabled || this.tracks.length === 0) return;
    const n = this.tracks.length;
    let idx = this.index;
    if (n > 1) while (idx === this.index) idx = Math.floor(Math.random() * n);
    this.transitionTo(idx, MANUAL_FADE, "crossfade");
  }

  /** Update the music + master mixer levels (0..1). */
  setLevel(music: number, master: number): void {
    this.levelMusic = Math.max(0, Math.min(1, music));
    this.levelMaster = Math.max(0, Math.min(1, master));
    if (this.levelGain && this.ctx) {
      const base = MUSIC_BASE * this.levelMusic * this.levelMaster;
      this.levelGain.gain.setTargetAtTime(base, this.ctx.currentTime, 0.08);
    }
  }

  /** Hard-silence (or restore) the music. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.muteGain) this.muteGain.gain.value = combinedMuteGain(this.muted, this.stationMuted);
  }

  /** Whether a playlist is currently active (drives CombatSfx pulse routing). */
  isActive(): boolean {
    return this.enabled && this.tracks.length > 0;
  }

  private cueDeck(deck: Deck, i: number): void {
    if (this.tracks.length === 0) return;
    const n = this.tracks.length;
    const idx = ((i % n) + n) % n;
    deck.el.src = this.tracks[idx];
    deck.el.load();
  }

  private playDeck(deck: Deck): void {
    if (!this.enabled || this.userPaused) return;
    const p = deck.el.play();
    if (p && typeof (p as Promise<void>).catch === "function") {
      (p as Promise<void>).catch(() => {
        /* awaiting a user gesture — resume() will retry */
      });
    }
  }

  /**
   * Blend from the active deck to `targetIndex` on the idle deck over `seconds`,
   * applying the given transition style. The foreground (`active`/`index`) and
   * now-playing readout flip immediately so the incoming song reads as "playing";
   * the outgoing deck is paused once faded.
   */
  private transitionTo(targetIndex: number, seconds: number, style: DjTransition): void {
    if (!this.ensureGraph() || this.tracks.length === 0) return;
    if (this.crossfading) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const from = this.decks[this.active];
    const to = this.decks[1 - this.active];
    if (!from || !to) return;
    // Any explicit track change implies the user wants sound — clear pause.
    this.userPaused = false;

    // Cue + start the incoming deck from silence.
    this.cueDeck(to, targetIndex);
    to.el.currentTime = 0;
    to.gain.gain.cancelScheduledValues(ctx.currentTime);
    to.gain.gain.setValueAtTime(0, ctx.currentTime);
    to.filter.frequency.cancelScheduledValues(ctx.currentTime);
    to.filter.frequency.setValueAtTime(style === "filter" ? FILTER_CLOSED : FILTER_OPEN, ctx.currentTime);
    to.send.gain.cancelScheduledValues(ctx.currentTime);
    to.send.gain.setValueAtTime(0, ctx.currentTime);
    this.playDeck(to);

    const t = ctx.currentTime;
    const sec = Math.max(0.05, seconds);
    if (style === "cut") {
      from.gain.gain.cancelScheduledValues(t);
      from.gain.gain.setValueAtTime(0, t);
      to.gain.gain.setValueAtTime(1, t);
    } else {
      from.gain.gain.cancelScheduledValues(t);
      from.gain.gain.setValueAtTime(from.gain.gain.value, t);
      from.gain.gain.linearRampToValueAtTime(0, t + sec);
      to.gain.gain.linearRampToValueAtTime(1, t + sec);
    }
    if (style === "filter") {
      from.filter.frequency.cancelScheduledValues(t);
      from.filter.frequency.setValueAtTime(FILTER_OPEN, t);
      from.filter.frequency.exponentialRampToValueAtTime(FILTER_CLOSED, t + sec);
      to.filter.frequency.exponentialRampToValueAtTime(FILTER_OPEN, t + sec);
    }
    if (style === "echo") {
      from.send.gain.cancelScheduledValues(t);
      from.send.gain.setValueAtTime(0.0001, t);
      from.send.gain.linearRampToValueAtTime(0.6, t + sec * 0.4);
      from.send.gain.linearRampToValueAtTime(0, t + sec);
    }

    // Flip the foreground immediately so the UI + pulse follow the incoming song.
    const prevActive = this.active;
    this.active = 1 - this.active;
    this.index = ((targetIndex % this.tracks.length) + this.tracks.length) % this.tracks.length;
    this.crossfading = true;
    this.onTrack?.(this.titles[this.index] ?? "", this.index);

    if (this.fadeTimer !== null) window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(
      () => {
        const outgoing = this.decks[prevActive];
        if (outgoing) {
          outgoing.el.pause();
          outgoing.gain.gain.value = 0;
          outgoing.filter.frequency.value = FILTER_OPEN;
          outgoing.send.gain.value = 0;
        }
        this.crossfading = false;
        this.fadeTimer = null;
      },
      sec * 1000 + 80,
    );
  }

  /** timeupdate on a deck: begin the auto-mix crossfade as the active track ends. */
  private onDeckTime(deck: Deck): void {
    if (this.crossfading) return;
    if (deck !== this.decks[this.active]) return;
    if (!this.config.autoMix || this.config.transition === "cut") return;
    if (this.tracks.length <= 1) return;
    const dur = deck.el.duration;
    if (!isFinite(dur) || dur <= 0) return;
    const remaining = dur - deck.el.currentTime;
    if (remaining <= this.config.crossfadeSec && remaining > 0.05) {
      this.transitionTo(this.pickNext(), this.config.crossfadeSec, this.config.transition);
    }
  }

  /** ended on a deck: hard-advance when we're NOT auto-mixing (cut behaviour). */
  private onDeckEnded(deck: Deck): void {
    if (this.crossfading) return;
    if (deck !== this.decks[this.active]) return; // faded-out deck — ignore
    const nextIndex = this.pickNext();
    this.index = nextIndex;
    deck.gain.gain.value = 1;
    deck.filter.frequency.value = FILTER_OPEN;
    this.cueDeck(deck, nextIndex);
    this.playDeck(deck);
    this.onTrack?.(this.titles[this.index] ?? "", this.index);
  }

  /**
   * Derive a {@link MusicPulse} from the live mix's spectrum: `intensity` from
   * overall energy, `beat`/`beatPhase` from an adaptive bass-onset detector — so
   * the DJ's dance and light show ride the actual song instead of a synth timer.
   */
  getPulse(): MusicPulse | null {
    const a = this.analyser;
    const ctx = this.ctx;
    if (!a || !ctx || this.decks.length === 0 || !this.freq) return null;
    const now = ctx.currentTime;
    const dt = this.lastPulseT > 0 ? Math.max(0, now - this.lastPulseT) : 0.016;
    this.lastPulseT = now;

    a.getByteFrequencyData(this.freq);
    const n = this.freq.length;
    const bassBins = Math.max(1, Math.floor(n * 0.12));
    let bass = 0;
    for (let i = 0; i < bassBins; i++) bass += this.freq[i];
    bass /= bassBins * 255;
    let overall = 0;
    for (let i = 0; i < n; i++) overall += this.freq[i];
    overall /= n * 255;

    // During a crossfade the foreground deck flips immediately, but the outgoing
    // deck is still audible on the mix bus — treat the pulse as live if EITHER
    // deck is playing so DJ-reactive visuals don't stutter across a transition.
    const playing = this.decks.some((d) => !d.el.paused && !d.el.ended);
    const target = playing ? Math.min(1, overall * 1.6) : 0;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 3);

    this.energyAvg += (bass - this.energyAvg) * Math.min(1, dt * 2);
    const sinceOnset = now - this.lastOnset;
    if (playing && bass > this.energyAvg * 1.35 + 0.04 && sinceOnset > 0.22) {
      if (this.lastOnset > 0) {
        const period = Math.min(1.2, Math.max(0.24, sinceOnset));
        this.beatPeriod += (period - this.beatPeriod) * 0.25;
      }
      this.lastOnset = now;
      this.beat++;
    }
    const phase =
      this.beatPeriod > 1e-3
        ? Math.max(0, Math.min(1, (now - this.lastOnset) / this.beatPeriod))
        : 0;
    return { intensity: this.intensity, beat: this.beat, beatPhase: phase };
  }
}

/** The one persistent music station shared across every mode/page. */
export const musicStation = new MusicStation();
