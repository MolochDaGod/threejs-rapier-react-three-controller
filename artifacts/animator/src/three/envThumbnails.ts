import * as THREE from "three";
import { DangerRoom } from "./DangerRoom";
import { ROOM_PRESETS, type RoomPresetId } from "./RoomPresets";
import {
  addStudioLights,
  STUDIO_FOG,
  STUDIO_TONE_MAPPING_EXPOSURE,
  studioLightingSignature,
} from "./studioLighting";

/**
 * Captures a small, real Three.js render of each {@link DangerRoom} environment
 * preset for use as an at-a-glance thumbnail in the Environment menu (replacing
 * the lightweight CSS swatch approximation).
 *
 * Each preset is built into a throwaway scene exactly as the live Danger Room
 * would build it (same floor/walls/grid/pillars/props + preset lighting mood),
 * rendered once through a shared offscreen WebGL renderer, captured as a PNG data
 * URL and cached. Subsequent requests for the same preset return the cached URL.
 *
 * If WebGL is unavailable (or any capture fails) the function resolves to `null`
 * so the caller can fall back to the CSS swatch. Once a context can't be created
 * we stop retrying for the session.
 */

/** Rendered thumbnail resolution (displayed much smaller; oversampled for crispness). */
const THUMB_W = 220;
const THUMB_H = 150;

interface CachedThumb {
  /** Signature of the preset + shared lighting at capture time. */
  hash: string;
  url: string;
}

const cache = new Map<RoomPresetId, CachedThumb>();
const inFlight = new Map<RoomPresetId, Promise<string | null>>();

/**
 * Bump when the capture rig itself changes (camera vantage, resolution, or the
 * DangerRoom structural shell that isn't captured by the preset/light data) so
 * cached thumbnails re-render even when the preset + lighting data are unchanged.
 */
const CAPTURE_VERSION = 1;

/**
 * A stable signature of everything the rendered thumbnail depends on: the
 * preset's full data (colours, props, accents, atmosphere), the shared Studio
 * lighting/fog, and the capture-rig version. When this changes for a preset, the
 * cached thumbnail is stale and re-rendered.
 */
function thumbHash(id: RoomPresetId): string {
  return JSON.stringify({
    v: CAPTURE_VERSION,
    preset: ROOM_PRESETS[id],
    lighting: studioLightingSignature(),
  });
}

let renderer: THREE.WebGLRenderer | null = null;
/** True once we've determined a WebGL context cannot be created (stop retrying). */
let rendererUnavailable = false;

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer) return renderer;
  if (rendererUnavailable) return null;
  try {
    const r = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      // Needed so toDataURL() can read the framebuffer after the render call.
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
    });
    r.setPixelRatio(1);
    r.setSize(THUMB_W, THUMB_H, false);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = STUDIO_TONE_MAPPING_EXPOSURE;
    renderer = r;
    return r;
  } catch {
    rendererUnavailable = true;
    return null;
  }
}

function capturePreset(id: RoomPresetId): string | null {
  const r = getRenderer();
  if (!r) return null;

  const scene = new THREE.Scene();
  // Match the live Danger Room atmosphere + lights from the shared definition so
  // the thumbnail reads true (no shadows for speed). A preset's own atmosphere is
  // applied per-room by DangerRoom; this is the dry baseline behind it.
  scene.background = new THREE.Color(STUDIO_FOG.color);
  scene.fog = new THREE.Fog(STUDIO_FOG.color, STUDIO_FOG.near, STUDIO_FOG.far);
  addStudioLights(scene);

  const room = new DangerRoom({ preset: id });
  // Settle the pulsing accents (door/DJ glow) to a representative state.
  room.update(0.6);
  scene.add(room.group);

  const camera = new THREE.PerspectiveCamera(55, THUMB_W / THUMB_H, 0.1, 200);
  // A diagonal interior vantage from just inside one corner, looking across the
  // floor toward the opposite wall — shows floor, grid, pillars and corner props.
  camera.position.set(9, 6.5, 12);
  camera.lookAt(0, 2.5, -3);

  let url: string | null = null;
  try {
    r.render(scene, camera);
    url = r.domElement.toDataURL("image/png");
  } catch {
    url = null;
  } finally {
    room.dispose();
    scene.clear();
  }
  return url;
}

/**
 * Resolve a cached rendered thumbnail (PNG data URL) for the given preset, or
 * `null` if rendering is unavailable. Safe to call repeatedly — the render
 * happens at most once per preset.
 */
export function renderEnvThumbnail(id: RoomPresetId): Promise<string | null> {
  const hash = thumbHash(id);
  const cached = cache.get(id);
  // Only reuse the cache when the preset + shared lighting haven't changed since
  // it was captured; otherwise the cached image has drifted and is re-rendered.
  if (cached && cached.hash === hash) return Promise.resolve(cached.url);

  const pending = inFlight.get(id);
  if (pending) return pending;

  const p = new Promise<string | null>((resolve) => {
    // Defer to a macrotask so building/rendering never blocks the click that
    // opened the menu (and lets the menu paint its CSS fallback first).
    setTimeout(() => {
      const url = capturePreset(id);
      // Recompute the hash at store-time so a concurrent design change is caught.
      if (url) cache.set(id, { hash: thumbHash(id), url });
      inFlight.delete(id);
      resolve(url);
    }, 0);
  });
  inFlight.set(id, p);
  return p;
}
