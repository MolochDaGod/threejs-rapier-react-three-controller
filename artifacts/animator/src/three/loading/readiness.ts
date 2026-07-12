/**
 * Scene-readiness manifest — a pure, framework-free model of the checklist a
 * play session must satisfy before gameplay starts (terrain/arena built,
 * character + weapon loaded, NPCs + their AI brains spawned, shaders warmed).
 *
 * It is intentionally free of any Three.js / DOM / React imports so it can be
 * unit-tested in the sandbox (no WebGL needed) and reused as the single source
 * of truth for both the loading-screen UI and the engine's start-gate.
 *
 * The boot sequence registers the items it expects up-front, then marks each
 * one ready or failed as the matching async load resolves. `snapshot()` folds
 * the items into an aggregate the loading screen renders and the engine gates on.
 */

/**
 * Hard stall timeout: the per-step no-progress window after which a gated boot is
 * declared failed (its loading screen drops to the error/retry state). This is a
 * *per-step* window — it resets on every forward readiness step — not total load
 * time. Generous on purpose: a slow-but-healthy load must never hit it.
 */
export const BOOT_STALL_TIMEOUT_MS = 30_000;

/**
 * Soft slow-notice window: the per-step no-progress window after which the loader
 * shows a calm "taking longer than usual" notice + an early "Back to menu", well
 * before the hard {@link BOOT_STALL_TIMEOUT_MS} failure.
 *
 * Calibration (see readiness.calibration.test.ts, which pins these exact values):
 * because the window is per-step and resets on every forward step, a normal/heavy
 * boot — physics, the procedural "explorer" rig (no GLB download), weapon, the
 * worker-meshed arena, synchronous NPC spawn — advances through its steps in low
 * single-digit seconds each on a healthy machine, so 8s never nags a healthy load
 * even with a big arena + many NPCs. It only trips when one step genuinely crawls
 * (e.g. a multi-MB GLB on a connection below ~10 Mbps), which is exactly when a
 * player deserves early relief, and it still leaves 22s of soft-escape runway
 * before the 30s hard stall.
 */
export const BOOT_SLOW_NOTICE_MS = 8_000;

export type ReadinessState = "pending" | "ready" | "failed";

export interface ReadinessItem {
  /** Stable key the boot code marks against (e.g. "character", "arena"). */
  key: string;
  /** Human label shown on the loading checklist. */
  label: string;
  /** Relative weight in the aggregate progress bar (heavier = slower step). */
  weight: number;
  state: ReadinessState;
  /** Populated when `state === "failed"`. */
  error?: string;
}

export interface ReadinessSnapshot {
  /** Items in registration order (stable for a checklist UI). */
  items: ReadinessItem[];
  /** 0..1 fraction of weight resolved (ready OR failed both count as "done"). */
  progress: number;
  /** True only when every registered item is ready. */
  ready: boolean;
  /** True when at least one item failed. */
  failed: boolean;
  /** First failure message, for the error UI. */
  error: string | null;
  /** Label of the first still-pending item, for a "loading X…" line. */
  current: string | null;
  /**
   * Soft "taking longer than expected" signal: true once the load has made no
   * progress for the slow-notice window (well under the hard stall timeout) but
   * has not failed or finished. Lets the UI surface a non-alarming notice + an
   * early escape without declaring failure. Clears the instant progress resumes.
   */
  slow: boolean;
}

/** Injectable timer pair so the stall watchdog is deterministic under test. */
export interface WatchdogTimers {
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface WatchdogOptions extends Partial<WatchdogTimers> {
  /**
   * No-progress window in ms. If aggregate progress does not advance for this
   * long while the load is still unresolved, the load is treated as stalled and
   * `onStall` fires. The timer resets every time progress moves forward, so a
   * slow-but-healthy load is never falsely flagged.
   */
  timeoutMs: number;
  /** Invoked once when the load stalls (no progress for `timeoutMs`). */
  onStall: () => void;
  /**
   * Optional soft "taking longer than expected" window in ms — must be well
   * under `timeoutMs`. When progress makes no headway for this long (but the
   * load has not failed or finished) the snapshot's `slow` flag flips true and
   * a fresh snapshot is emitted, so the UI can offer an early, non-alarming
   * escape. Like the stall timer it resets on every forward step, and `slow`
   * clears the instant progress resumes. Omit (or set 0) to disable.
   */
  slowMs?: number;
}

export class ReadinessManifest {
  private readonly items = new Map<string, ReadinessItem>();
  private readonly order: string[] = [];
  private listener: ((s: ReadinessSnapshot) => void) | null = null;

  // ---- Stall watchdog ----
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private watchdogOnStall: (() => void) | null = null;
  private watchdogTimeoutMs = 0;
  /** Highest progress fraction seen, so we only reset on genuine forward motion. */
  private watchdogProgress = 0;
  private setTimer: WatchdogTimers["setTimer"] = (fn, ms) => setTimeout(fn, ms);
  private clearTimer: WatchdogTimers["clearTimer"] = (h) => clearTimeout(h);

  // ---- Soft slow-notice timer (rides alongside the stall watchdog) ----
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  private slowNoticeMs = 0;
  /** Current soft-slow state, surfaced in every snapshot as `slow`. */
  private slow = false;

  /** Register a required item as pending. Re-adding a key is a no-op. */
  add(key: string, label: string, weight = 1): this {
    if (this.items.has(key)) return this;
    this.items.set(key, { key, label, weight, state: "pending" });
    this.order.push(key);
    return this;
  }

  has(key: string): boolean {
    return this.items.has(key);
  }

  state(key: string): ReadinessState | null {
    return this.items.get(key)?.state ?? null;
  }

  /** Mark an item ready. No-op if the key is absent or already ready. */
  markReady(key: string): void {
    const item = this.items.get(key);
    if (!item || item.state === "ready") return;
    item.state = "ready";
    item.error = undefined;
    this.emit();
  }

  /** Mark an item failed (surfaces in the error UI). No-op if absent. */
  markFailed(key: string, error: string): void {
    const item = this.items.get(key);
    if (!item || (item.state === "failed" && item.error === error)) return;
    item.state = "failed";
    item.error = error;
    this.emit();
  }

  /** Subscribe to snapshots. Only one listener is supported (the owner). */
  onChange(cb: (s: ReadinessSnapshot) => void): void {
    this.listener = cb;
  }

  /** True when every registered item is ready. */
  isReady(): boolean {
    return this.snapshot().ready;
  }

  /**
   * True when every registered item EXCEPT the named ones is ready. Used to gate
   * the shader pre-warm step (run only once all assets are in the scene, before
   * the final "shaders" item itself is marked ready). Vacuously true when no
   * non-excluded items remain.
   */
  allReadyExcept(...except: string[]): boolean {
    const skip = new Set(except);
    for (const item of this.items.values()) {
      if (skip.has(item.key)) continue;
      if (item.state !== "ready") return false;
    }
    return true;
  }

  snapshot(): ReadinessSnapshot {
    const items = this.order.map((k) => ({ ...this.items.get(k)! }));
    let total = 0;
    let done = 0;
    let failed = false;
    let error: string | null = null;
    let current: string | null = null;
    for (const it of items) {
      total += it.weight;
      if (it.state === "ready" || it.state === "failed") done += it.weight;
      if (it.state === "failed") {
        failed = true;
        if (error === null) error = it.error ?? `${it.label} failed to load`;
      }
      if (it.state === "pending" && current === null) current = it.label;
    }
    const ready = items.length > 0 && items.every((it) => it.state === "ready");
    const progress = total === 0 ? 1 : done / total;
    return { items, progress, ready, failed, error, current, slow: this.slow };
  }

  /**
   * Arm a stall watchdog. While the load is unresolved (not ready, not failed),
   * `onStall` fires if aggregate progress fails to advance for `timeoutMs`. The
   * timer resets on every forward step (so slow-but-healthy loads are safe) and
   * stops automatically once the load resolves. Re-arming replaces any prior
   * watchdog. Pass `setTimer`/`clearTimer` to drive it with fake timers in tests.
   */
  startWatchdog(opts: WatchdogOptions): void {
    this.stopWatchdog();
    this.watchdogTimeoutMs = opts.timeoutMs;
    this.watchdogOnStall = opts.onStall;
    this.slowNoticeMs = opts.slowMs ?? 0;
    this.slow = false;
    if (opts.setTimer) this.setTimer = opts.setTimer;
    if (opts.clearTimer) this.clearTimer = opts.clearTimer;
    this.watchdogProgress = this.snapshot().progress;
    this.armWatchdog();
    this.armSlowNotice();
  }

  /** Cancel the stall watchdog and soft slow-notice timer (idempotent). */
  stopWatchdog(): void {
    if (this.watchdog !== null) {
      this.clearTimer(this.watchdog);
      this.watchdog = null;
    }
    if (this.slowTimer !== null) {
      this.clearTimer(this.slowTimer);
      this.slowTimer = null;
    }
    this.watchdogOnStall = null;
  }

  private armWatchdog(): void {
    if (this.watchdogOnStall === null) return;
    this.watchdog = this.setTimer(() => {
      this.watchdog = null;
      this.watchdogOnStall?.();
    }, this.watchdogTimeoutMs);
  }

  /**
   * Arm the soft slow-notice timer. On fire it flips `slow` true and emits a
   * fresh snapshot (no failure). No-op when the watchdog is unarmed or no
   * slow-notice window was configured.
   */
  private armSlowNotice(): void {
    if (this.watchdogOnStall === null || this.slowNoticeMs <= 0) return;
    this.slowTimer = this.setTimer(() => {
      this.slowTimer = null;
      if (this.slow) return;
      this.slow = true;
      // Surface the soft "taking longer than expected" state to the listener.
      this.listener?.(this.snapshot());
    }, this.slowNoticeMs);
  }

  private emit(): void {
    const snap = this.snapshot();
    if (this.watchdogOnStall !== null) {
      if (snap.ready || snap.failed) {
        // Load resolved (or hard-failed) — the safety net is no longer needed.
        this.stopWatchdog();
      } else if (snap.progress > this.watchdogProgress) {
        // Genuine forward progress: reset the no-progress window for both timers
        // and clear any soft slow-notice so a recovering load drops the notice.
        this.watchdogProgress = snap.progress;
        if (this.watchdog !== null) this.clearTimer(this.watchdog);
        this.armWatchdog();
        if (this.slowTimer !== null) this.clearTimer(this.slowTimer);
        if (this.slow) {
          this.slow = false;
          snap.slow = false;
        }
        this.armSlowNotice();
      }
    }
    this.listener?.(snap);
  }
}
