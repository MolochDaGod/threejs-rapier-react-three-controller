/**
 * Boot readiness gate — the WebGL-free wiring that sits between the engine's
 * async boot steps and the React loading screen.
 *
 * `Studio` cannot be constructed in a headless test (its constructor builds a
 * `WebGLRenderer` up-front, which throws with no GL context), so all of the
 * gate's decision logic — which checklist items a session registers, forwarding
 * snapshots to the loading screen, the soft slow-notice + hard-stall watchdog,
 * failing still-pending items on a stall, and the "all assets in → pre-warm +
 * open" trigger — lives here instead. It owns a {@link ReadinessManifest} and
 * touches no Three.js / DOM, so the whole boot experience can be exercised in
 * the sandbox with fake timers.
 *
 * `Studio` keeps only the pieces that genuinely need WebGL (building the scene,
 * `renderer.compile` pre-warm) and delegates the rest here via callbacks.
 */

import {
  BOOT_SLOW_NOTICE_MS,
  BOOT_STALL_TIMEOUT_MS,
  ReadinessManifest,
  type ReadinessSnapshot,
  type WatchdogTimers,
} from "./readiness";

/** Resolved facts about a session that decide which checklist items it registers. */
export interface BootGateItems {
  /** True when the session builds an authored arena (adds the "arena" item). */
  hasArena: boolean;
  /** Authored NPC count in the arena; > 0 adds the "npcs" item. */
  npcCount: number;
}

export interface BootGateCallbacks {
  /** Forwarded on every readiness change (drives the React loading screen). */
  onReadiness: (s: ReadinessSnapshot) => void;
  /**
   * Fired exactly once, when every asset item except the shader pre-warm is
   * ready. The host bakes + pre-warms shaders and opens the gameplay gate.
   */
  onAssetsReady: () => void;
  /** True once the host has opened the gameplay gate (gameplay started). */
  isReady: () => boolean;
  /** True once the host is disposed (suppresses late marks + stall handling). */
  isDisposed: () => boolean;
}

export interface BootGateOptions extends BootGateCallbacks {
  /** Hard per-step stall window before failure (defaults to {@link BOOT_STALL_TIMEOUT_MS}). */
  stallMs?: number;
  /** Soft per-step slow-notice window (defaults to {@link BOOT_SLOW_NOTICE_MS}). */
  slowMs?: number;
  /** Injectable timers so the watchdog is deterministic under test. */
  timers?: WatchdogTimers;
}

export class BootGate {
  /** The underlying readiness checklist; boot steps mark items against it. */
  readonly manifest = new ReadinessManifest();
  private readonly cb: BootGateCallbacks;
  private readonly stallMs: number;
  private readonly slowMs: number;
  private readonly timers?: WatchdogTimers;
  /** Guards the one-shot "all assets in → pre-warm" trigger. */
  private prewarmStarted = false;

  constructor(items: BootGateItems, opts: BootGateOptions) {
    this.cb = opts;
    this.stallMs = opts.stallMs ?? BOOT_STALL_TIMEOUT_MS;
    this.slowMs = opts.slowMs ?? BOOT_SLOW_NOTICE_MS;
    this.timers = opts.timers;
    this.register(items);
  }

  /**
   * Register the gated checklist and arm the stall watchdog. Items are marked
   * ready / failed by the matching async boot step as it resolves; once every
   * asset item except the shader pre-warm is in, {@link BootGateCallbacks.onAssetsReady}
   * fires so the host can pre-warm + open the gate.
   */
  private register(items: BootGateItems): void {
    this.manifest.add("physics", "Initializing physics", 1);
    this.manifest.add("character", "Loading fighter", 2);
    // Required animation clips: confirmed against the committed rig (the boot
    // fails if the fighter lands without its baseline movement clips, instead
    // of opening into a frozen T-pose).
    this.manifest.add("requiredClips", "Loading animation clips", 1);
    this.manifest.add("weapon", "Equipping weapon", 1);
    // Door portal placement: confirmed against the built room (door position
    // finite + the proximity trigger actually fires there), so a broken preset
    // can't open a session whose dungeon door is unreachable.
    this.manifest.add("doors", "Placing door portal", 1);
    if (items.hasArena) {
      this.manifest.add("arena", "Building arena", 3);
      if (items.npcCount > 0) this.manifest.add("npcs", "Deploying opponents", 2);
    }
    // Pre-warm step (compiled last, after every asset is in the scene).
    this.manifest.add("shaders", "Warming up shaders", 1);
    this.manifest.onChange((s) => this.handleReadiness(s));
    // Stall safety net: if no boot step makes progress for a generous window (a
    // loader that never resolves AND never rejects), fail the pending items so the
    // loading screen resolves to its error/recovery state instead of freezing
    // forever. The watchdog resets on every forward step, so a slow-but-healthy
    // load is never falsely flagged; it auto-stops on `ready`/failure and dispose.
    this.manifest.startWatchdog({
      timeoutMs: this.stallMs,
      slowMs: this.slowMs,
      onStall: () => this.failPending(),
      ...(this.timers ?? {}),
    });
  }

  /**
   * Readiness change handler: forward the snapshot to the loading screen, and —
   * once every asset item except the shader pre-warm is ready — fire the one-shot
   * pre-warm + open trigger.
   */
  private handleReadiness(s: ReadinessSnapshot): void {
    this.cb.onReadiness(s);
    if (this.cb.isReady() || s.failed) return;
    if (!this.prewarmStarted && this.manifest.allReadyExcept("shaders")) {
      this.prewarmStarted = true;
      this.cb.onAssetsReady();
    }
  }

  /**
   * Stall-watchdog handler: mark every still-pending item as failed so a
   * never-resolving loader can't hold the gate open indefinitely. No-op once the
   * session is ready or disposed.
   */
  private failPending(): void {
    if (this.cb.isDisposed() || this.cb.isReady()) return;
    for (const item of this.manifest.snapshot().items) {
      if (item.state === "pending") {
        this.markFailed(item.key, `${item.label} timed out.`);
      }
    }
  }

  /** Mark a readiness item ready; no-op once disposed. */
  markReady(key: string): void {
    if (this.cb.isDisposed()) return;
    this.manifest.markReady(key);
  }

  /** Mark a readiness item failed (surfaces in the loading screen's error state); no-op once disposed. */
  markFailed(key: string, error: string): void {
    if (this.cb.isDisposed()) return;
    this.manifest.markFailed(key, error);
  }

  /** Current readiness snapshot (used to seed the loading screen). */
  snapshot(): ReadinessSnapshot {
    return this.manifest.snapshot();
  }

  /** Cancel the stall + slow-notice timers (idempotent). */
  stopWatchdog(): void {
    this.manifest.stopWatchdog();
  }
}
