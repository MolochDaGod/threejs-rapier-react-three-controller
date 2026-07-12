/**
 * Device-local persistence for the controller / camera / mouse "feel" settings
 * (the `EditorParams` block surfaced in the Editor panel). Stored in
 * localStorage, schema-versioned, and clamped on load so a stale or corrupt
 * blob can never feed NaN into the camera/physics. This mirrors the
 * `fxSettings` / `soundSettings` modules so every settings group in the studio
 * persists the same way — previously these reset to defaults on every reload,
 * the lone group that didn't stick.
 *
 * This is the animator artifact, so NOTHING here may import `@workspace/*`.
 */

import { DEFAULT_EDITOR, type EditorParams } from "./types";

/**
 * Inclusive [min, max] bounds for each persisted numeric field, kept in lockstep
 * with the slider ranges in `EditorPanel.tsx`. Anything outside the range (or
 * non-finite) falls back to the default on load.
 */
export const CONTROL_RANGES: Record<string, readonly [number, number]> = {
  moveSpeed: [1, 10],
  sprintMultiplier: [1, 3],
  jumpHeight: [0.5, 5],
  gravity: [8, 40],
  cameraDistance: [2.5, 10],
  cameraHeight: [0.5, 3],
  mouseSensitivity: [0.2, 3],
  fov: [40, 100],
  turnResponsiveness: [2, 25],
  blendTime: [0.05, 0.6],
  dashDistance: [2, 12],
  aoeRadius: [1.5, 8],
  skillForce: [4, 30],
  skyfallBolts: [1, 12],
  attackSteer: [0, 1.5],
};

const KEY = "dangerroom:controls";
const SCHEMA = 1;

const clampNum = (v: unknown, [min, max]: readonly [number, number], d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;

const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);

/**
 * Load the persisted control settings, falling back to `DEFAULT_EDITOR` for any
 * missing/invalid field. `modelYaw` is intentionally NOT persisted — it is a
 * per-character facing offset, so a value tuned for one rig must not leak onto
 * the next one; it always resets to the default.
 */
export function loadControls(): EditorParams {
  const d = DEFAULT_EDITOR;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...d };
    const o = JSON.parse(raw) as Partial<EditorParams> & { schema?: number };
    if (o.schema !== SCHEMA) return { ...d };
    return {
      moveSpeed: clampNum(o.moveSpeed, CONTROL_RANGES.moveSpeed, d.moveSpeed),
      sprintMultiplier: clampNum(o.sprintMultiplier, CONTROL_RANGES.sprintMultiplier, d.sprintMultiplier),
      jumpHeight: clampNum(o.jumpHeight, CONTROL_RANGES.jumpHeight, d.jumpHeight),
      gravity: clampNum(o.gravity, CONTROL_RANGES.gravity, d.gravity),
      cameraDistance: clampNum(o.cameraDistance, CONTROL_RANGES.cameraDistance, d.cameraDistance),
      cameraHeight: clampNum(o.cameraHeight, CONTROL_RANGES.cameraHeight, d.cameraHeight),
      mouseSensitivity: clampNum(o.mouseSensitivity, CONTROL_RANGES.mouseSensitivity, d.mouseSensitivity),
      fov: clampNum(o.fov, CONTROL_RANGES.fov, d.fov),
      turnResponsiveness: clampNum(o.turnResponsiveness, CONTROL_RANGES.turnResponsiveness, d.turnResponsiveness),
      blendTime: clampNum(o.blendTime, CONTROL_RANGES.blendTime, d.blendTime),
      showSkeleton: bool(o.showSkeleton, d.showSkeleton),
      modelYaw: d.modelYaw,
      invertY: bool(o.invertY, d.invertY),
      dashDistance: clampNum(o.dashDistance, CONTROL_RANGES.dashDistance, d.dashDistance),
      aoeRadius: clampNum(o.aoeRadius, CONTROL_RANGES.aoeRadius, d.aoeRadius),
      skillForce: clampNum(o.skillForce, CONTROL_RANGES.skillForce, d.skillForce),
      skyfallBolts: clampNum(o.skyfallBolts, CONTROL_RANGES.skyfallBolts, d.skyfallBolts),
      attackSteer: clampNum(o.attackSteer, CONTROL_RANGES.attackSteer, d.attackSteer),
    };
  } catch {
    return { ...d };
  }
}

export function saveControls(p: EditorParams): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...p, modelYaw: undefined, schema: SCHEMA }));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
  // Notify live listeners (Voxel Editor orbit, Dressing Room OrbitControls) so a
  // Mouse Sens / Invert Y change applies immediately, without re-entering the
  // mode. The persisted blob above stays the source of truth for fresh mounts.
  notifyMouseFeel({ sensitivity: p.mouseSensitivity, invertY: p.invertY });
}

export interface MouseFeel {
  sensitivity: number;
  invertY: boolean;
}

/**
 * Lightweight subset read used by non-combat modes (e.g. the Voxel Editor) that
 * only need the shared mouse feel so the global Mouse Sens / Invert Y settings
 * apply uniformly everywhere, not just in the Danger Room controller.
 */
export function loadMouseFeel(): MouseFeel {
  const c = loadControls();
  return { sensitivity: c.mouseSensitivity, invertY: c.invertY };
}

const mouseFeelListeners = new Set<(feel: MouseFeel) => void>();

/**
 * Subscribe to live mouse-feel (Mouse Sens / Invert Y) changes. Fires whenever
 * {@link saveControls} runs — e.g. when a slider/toggle in the Editor panel is
 * adjusted — so already-open surfaces can update their camera in place instead
 * of only re-reading the persisted value at mount. Returns an unsubscribe fn;
 * callers MUST call it on teardown to avoid a leaked reference to a disposed
 * scene.
 */
export function subscribeMouseFeel(cb: (feel: MouseFeel) => void): () => void {
  mouseFeelListeners.add(cb);
  return () => {
    mouseFeelListeners.delete(cb);
  };
}

function notifyMouseFeel(feel: MouseFeel): void {
  for (const cb of mouseFeelListeners) {
    try {
      cb(feel);
    } catch {
      /* a listener error must not break persistence or other listeners */
    }
  }
}
