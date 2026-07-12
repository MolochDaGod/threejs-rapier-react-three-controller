/** Clamp a raw pointer movement delta to ±max, rejecting browser spikes. */
function clampMove(v: number, max: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -max ? -max : v > max ? max : v;
}

/** Window (ms) within which two fresh presses of the same key count as a double-tap. */
const DOUBLE_TAP_MS = 280;

/** Lightweight keyboard + mouse state tracker for the studio. */
export class InputState {
  keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;

  // Double-tap edge detection (A-A / D-D dodge rolls). `tapAt` holds the time of
  // the last *fresh* press per key; a second fresh press inside DOUBLE_TAP_MS
  // queues the code in `doubleTaps` for a consumer to drain via consumeDoubleTap.
  private tapAt: Record<string, number> = {};
  private doubleTaps = new Set<string>();
  // Single fresh-press edges (one entry per keydown that wasn't OS key-repeat),
  // drained via consumePress — used for stance-gated single-tap actions.
  private pressed = new Set<string>();

  // Touch / virtual input (mobile on-screen controls). Analog move is -1..1 on
  // each axis (x = strafe, y = forward); look deltas are injected straight into
  // the mouse accumulators while `lookActive` lets the Controller apply them
  // without pointer lock.
  moveX = 0;
  moveY = 0;
  lookActive = false;
  touchSprint = false;

  // True for the first mousemove after pointer lock is (re)acquired. Browsers
  // (notably Chrome) deliver a bogus, huge movementX/Y on that warm-up event,
  // which would whip the camera to the far wall — so we drop it.
  private freshLock = false;

  private dom: HTMLElement;
  private onKeyDown = (e: KeyboardEvent) => {
    // Don't swallow typing inside form fields.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    // Edge-detect a fresh press: OS auto-repeat re-fires keydown while a key is
    // held, so a double-tap must be two *fresh* presses inside the window, never
    // key-repeat.
    const fresh = !this.keys.has(e.code);
    this.keys.add(e.code);
    if (fresh) {
      this.pressed.add(e.code);
      const now = performance.now();
      const last = this.tapAt[e.code] ?? 0;
      if (now - last <= DOUBLE_TAP_MS) {
        this.doubleTaps.add(e.code);
        this.tapAt[e.code] = 0;
      } else {
        this.tapAt[e.code] = now;
      }
    }
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    // Drop the first event after acquiring lock: its delta is unreliable and is
    // the usual source of the "camera snaps across the room" jolt.
    if (this.freshLock) {
      this.freshLock = false;
      return;
    }
    // Clamp per-event deltas to reject spurious browser spikes. A real flick is
    // tens of pixels per event; anything beyond MAX_MOVE is noise, not intent.
    const MAX_MOVE = 120;
    this.mouseDX += clampMove(e.movementX, MAX_MOVE);
    this.mouseDY += clampMove(e.movementY, MAX_MOVE);
  };
  private onWheel = (e: WheelEvent) => {
    this.wheel += e.deltaY;
  };
  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.dom;
    if (this.locked) {
      // Arm the warm-up skip and drop any deltas queued during the transition.
      this.freshLock = true;
      this.mouseDX = 0;
      this.mouseDY = 0;
    } else {
      this.keys.clear();
      this.doubleTaps.clear();
      this.pressed.clear();
      this.tapAt = {};
    }
  };

  constructor(dom: HTMLElement) {
    this.dom = dom;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    dom.addEventListener("wheel", this.onWheel, { passive: true });
    document.addEventListener("pointerlockchange", this.onLockChange);
  }

  /** Set analog movement from a virtual joystick (x = strafe, y = forward). */
  setMove(x: number, y: number) {
    this.moveX = x;
    this.moveY = y;
  }

  /** Inject look deltas from a touch drag (feeds the mouse accumulators). */
  addLook(dx: number, dy: number) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** Press/release a virtual key from an on-screen button. */
  pressVirtual(code: string) {
    this.keys.add(code);
  }
  releaseVirtual(code: string) {
    this.keys.delete(code);
  }

  requestLock() {
    this.dom.requestPointerLock?.();
  }

  exitLock() {
    if (document.pointerLockElement === this.dom) document.exitPointerLock?.();
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** Drain a queued double-tap for `code` (true once per detected double-tap). */
  consumeDoubleTap(code: string): boolean {
    if (this.doubleTaps.has(code)) {
      this.doubleTaps.delete(code);
      return true;
    }
    return false;
  }

  /** Drain a single fresh-press edge for `code` (true once per keydown). */
  consumePress(code: string): boolean {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  /** Consume accumulated mouse/wheel deltas (call once per frame). */
  consumeMouse(): { dx: number; dy: number; wheel: number } {
    const out = { dx: this.mouseDX, dy: this.mouseDY, wheel: this.wheel };
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    return out;
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.dom.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("pointerlockchange", this.onLockChange);
  }
}
