import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * Rendered portraits for the HUD status frames (player + locked target). When
 * a hostile is Tab-locked, the engine asks its `CombatTargets` for a stable
 * portrait key + the live visual root; the player frame requests one for the
 * player's own rig. This module captures a one-off face close-up render of
 * that rig (cloned, so the live scene is never touched) into a small offscreen
 * WebGL canvas. The PNG data URL is cached per key, so each enemy *type*
 * (training dummy, ogre, bear, boss bot, avatar duelist, primitive fighter,
 * dungeon kind) renders at most once per session.
 *
 * If WebGL is unavailable or a capture fails, the key caches `null` and the
 * HUD falls back to the initial-letter portrait. React reads the cache through
 * a tiny external store (`subscribeTargetPortraits` + version snapshot).
 */

/** Portrait capture resolution (displayed at ~76px; oversampled for crispness). */
const PORTRAIT_SIZE = 160;

/** Nodes with this name are pruned from the captured clone (selection shells). */
export const PORTRAIT_OMIT_NAME = "selection-outline";

/**
 * Nodes with this `userData` flag are pruned from the captured clone. Weapon
 * mounts set it so held blades/staffs never inflate the face-crop bounds.
 */
export const PORTRAIT_OMIT_FLAG = "portraitOmit";

// ---------------------------------------------------------------------------
// External store (React reads via useSyncExternalStore)
// ---------------------------------------------------------------------------

const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const fn of listeners) fn();
}

export function subscribeTargetPortraits(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Monotonic store version — a stable snapshot for useSyncExternalStore. */
export function targetPortraitVersion(): number {
  return version;
}

/**
 * The cached portrait for `key`: a data URL, `null` when capture failed (use
 * the letter fallback), or `undefined` when not captured (yet).
 */
export function getTargetPortrait(key: string): string | null | undefined {
  return cache.get(key);
}

// ---------------------------------------------------------------------------
// Framing math (pure, unit-tested)
// ---------------------------------------------------------------------------

export interface PortraitFraming {
  /** Camera position. */
  eye: { x: number; y: number; z: number };
  /** Point the camera looks at. */
  look: { x: number; y: number; z: number };
}

/** How tightly the portrait crops the subject. */
export type PortraitMode = "bust" | "face";

/**
 * Portrait framing for a subject bounding box: look at a point near the top of
 * the box (the head) and stand the camera off along +Z (rigs face +Z).
 * `"face"` (the HUD default) crops to a tight head close-up; `"bust"` fits
 * roughly head + shoulders.
 */
export function portraitFraming(
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  fovDeg = 30,
  mode: PortraitMode = "face",
): PortraitFraming {
  const height = Math.max(0.001, max.y - min.y);
  const width = Math.max(0.001, max.x - min.x);
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  // Aim at the head band: ~82% of body height for a bust, ~87% for a face.
  const lookY = min.y + height * (mode === "face" ? 0.87 : 0.82);
  // Vertical span to fit: head-only for a face, head + shoulders for a bust.
  // Never crop an unusually wide subject (beasts): fit a fraction of its
  // width too.
  const halfSpan =
    mode === "face"
      ? Math.max(height * 0.17, width * 0.3)
      : Math.max(height * 0.28, width * 0.42);
  const dist = halfSpan / Math.tan((fovDeg * Math.PI) / 360);
  return {
    eye: { x: cx, y: lookY + height * 0.02, z: max.z + dist },
    look: { x: cx, y: lookY, z: cz },
  };
}

// ---------------------------------------------------------------------------
// Offscreen capture rig
// ---------------------------------------------------------------------------

let renderer: THREE.WebGLRenderer | null = null;
/** True once a WebGL context cannot be created (stop retrying this session). */
let rendererUnavailable = false;

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer) return renderer;
  if (rendererUnavailable) return null;
  try {
    const r = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      // Needed so toDataURL() can read the framebuffer after the render call.
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
    });
    r.setPixelRatio(1);
    r.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE, false);
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    renderer = r;
    return r;
  } catch {
    rendererUnavailable = true;
    return null;
  }
}

/** Render a prepared (origin-posed) clone into a PNG data URL, or null. */
function renderClone(subject: THREE.Object3D): string | null {
  const r = getRenderer();
  if (!r) return null;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x2a2018, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.4, 2.2, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88b4ff, 1.0);
  rim.position.set(-2, 1.5, -2.5);
  scene.add(rim);
  scene.add(subject);

  subject.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(subject);
  if (box.isEmpty()) return null;
  const framing = portraitFraming(box.min, box.max);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  camera.position.set(framing.eye.x, framing.eye.y, framing.eye.z);
  camera.lookAt(framing.look.x, framing.look.y, framing.look.z);

  try {
    r.render(scene, camera);
    return r.domElement.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    scene.remove(subject);
    scene.clear();
  }
}

/**
 * Prepare a live rig for capture: SkeletonUtils-clone (keeps the current pose,
 * shares geometry + materials — nothing here is ever disposed), reset the root
 * transform so it stands at the origin facing +Z, prune selection shells and
 * hidden nodes, and disable frustum culling (skinned bounds are unreliable).
 */
function prepareClone(object: THREE.Object3D): THREE.Object3D | null {
  let subject: THREE.Object3D;
  try {
    subject = cloneSkeleton(object);
  } catch {
    return null;
  }
  subject.position.set(0, 0, 0);
  subject.quaternion.identity();
  const prune: THREE.Object3D[] = [];
  subject.traverse((o) => {
    if (
      o.name === PORTRAIT_OMIT_NAME ||
      o.userData?.[PORTRAIT_OMIT_FLAG] === true ||
      (!o.visible && o !== subject)
    )
      prune.push(o);
    o.frustumCulled = false;
  });
  for (const o of prune) o.parent?.remove(o);
  subject.visible = true;
  return subject;
}

// Test seam: swaps the WebGL render for a stub in unit tests (no GL in vitest).
// The capture receives the already-prepared origin-posed CLONE, never the live rig.
type CaptureFn = (subject: THREE.Object3D) => string | null;
let captureImpl: CaptureFn = renderClone;
export function __setCaptureForTests(fn: CaptureFn | null): void {
  captureImpl = fn ?? renderClone;
}

const inFlight = new Set<string>();
/**
 * Per-key request generation. `invalidateTargetPortrait` bumps it so a capture
 * that was already in flight when the key was invalidated cannot land its
 * (stale) result — the next request re-captures the current look instead.
 */
const generation = new Map<string, number>();

/**
 * Ensure a portrait exists (or is being captured) for `key`, using `object` as
 * the live subject. Cheap no-op when already cached or in flight — safe to
 * call every frame while a target stays locked. The rig is cloned synchronously
 * (so a dead/despawned subject can't be captured later), but the actual render
 * is deferred a macrotask so lock-on never hitches the combat frame.
 */
export function requestTargetPortrait(key: string, object: THREE.Object3D): void {
  if (cache.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  const gen = generation.get(key) ?? 0;
  const subject = prepareClone(object);
  setTimeout(() => {
    let url: string | null = null;
    try {
      url = subject ? captureImpl(subject) : null;
    } catch {
      url = null;
    }
    // Stale completion: the key was invalidated (or fully cleared) while this
    // capture was in flight — drop the result so a fresh request re-captures.
    if ((generation.get(key) ?? 0) !== gen) return;
    cache.set(key, url);
    inFlight.delete(key);
    notify();
  }, 0);
}

/**
 * Drop one cached (or in-flight) portrait so the next request re-captures it.
 * Used for the player's own portrait, whose look can change between spawns
 * (Avatar Edit head, wardrobe) while the key stays stable.
 */
export function invalidateTargetPortrait(key: string): void {
  const hadCache = cache.delete(key);
  const hadInFlight = inFlight.delete(key);
  if (!hadCache && !hadInFlight) return;
  generation.set(key, (generation.get(key) ?? 0) + 1);
  notify();
}

/** Test/HMR hook: drop every cached portrait (they re-render on next lock). */
export function clearTargetPortraits(): void {
  for (const key of new Set([...cache.keys(), ...inFlight])) {
    generation.set(key, (generation.get(key) ?? 0) + 1);
  }
  cache.clear();
  inFlight.clear();
  notify();
}
