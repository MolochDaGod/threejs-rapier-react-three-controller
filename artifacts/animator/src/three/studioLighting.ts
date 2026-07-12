import * as THREE from "three";

/**
 * Single shared definition of the Danger Room's base lighting + fog atmosphere.
 *
 * Both the live {@link Studio} scene and the offscreen environment-thumbnail
 * renderer ({@link renderEnvThumbnail}) build their lights and dry-fog baseline
 * from THESE values, so the cached preview can never silently drift from the
 * real room: change a light here and both the live scene and the thumbnail move
 * in lockstep (and the thumbnail cache invalidates — see `LIGHTING_VERSION`).
 *
 * The lights are described as plain serialisable data so the same array can be
 * (a) turned into real `THREE` lights via {@link addStudioLights} and (b) folded
 * into the thumbnail cache hash without any bespoke book-keeping.
 */

/** The dry-fog / background baseline (overridden per-preset by `RoomAtmosphere`). */
export const STUDIO_FOG = {
  color: 0x05070c,
  near: 22,
  far: 46,
} as const;

/** ACES exposure shared by the live renderer and the thumbnail renderer. */
export const STUDIO_TONE_MAPPING_EXPOSURE = 1.1;

interface AmbientSpec {
  type: "ambient";
  color: number;
  intensity: number;
}
interface HemiSpec {
  type: "hemisphere";
  sky: number;
  ground: number;
  intensity: number;
}
interface DirectionalSpec {
  type: "directional";
  color: number;
  intensity: number;
  pos: [number, number, number];
  /** When true this light casts shadows (only honoured when shadows are enabled). */
  shadow?: boolean;
}
interface PointSpec {
  type: "point";
  color: number;
  intensity: number;
  distance: number;
  decay: number;
  pos: [number, number, number];
}

export type StudioLightSpec = AmbientSpec | HemiSpec | DirectionalSpec | PointSpec;

/**
 * The Danger Room base rig: cool ambient + sky/ground hemisphere so nothing
 * reads pure black, a crisp shadow-casting key, a magenta sci-fi rim, an
 * overhead blue fill and a warm low bounce to lift shadowed fronts.
 */
export const STUDIO_LIGHTS: readonly StudioLightSpec[] = [
  { type: "ambient", color: 0x4060a0, intensity: 0.55 },
  { type: "hemisphere", sky: 0xa8ccff, ground: 0x0a0e16, intensity: 0.9 },
  { type: "directional", color: 0xdaeaff, intensity: 2.1, pos: [10, 20, 8], shadow: true },
  { type: "directional", color: 0xff5a8a, intensity: 0.8, pos: [-12, 9, -10] },
  { type: "point", color: 0x57b0ff, intensity: 1.1, distance: 70, decay: 1.6, pos: [0, 15, 0] },
  { type: "point", color: 0xffd9a0, intensity: 0.5, distance: 44, decay: 1.8, pos: [0, 3, 9] },
] as const;

/**
 * Add the shared Danger Room lights to `scene`. Pass `shadows: true` for the
 * live scene (configures the key light's shadow camera); the lightweight
 * thumbnail renderer omits shadows for speed.
 */
export function addStudioLights(scene: THREE.Scene, opts: { shadows?: boolean } = {}): void {
  for (const spec of STUDIO_LIGHTS) {
    switch (spec.type) {
      case "ambient":
        scene.add(new THREE.AmbientLight(spec.color, spec.intensity));
        break;
      case "hemisphere":
        scene.add(new THREE.HemisphereLight(spec.sky, spec.ground, spec.intensity));
        break;
      case "directional": {
        const light = new THREE.DirectionalLight(spec.color, spec.intensity);
        light.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
        if (spec.shadow && opts.shadows) {
          light.castShadow = true;
          light.shadow.mapSize.set(2048, 2048);
          light.shadow.camera.near = 1;
          light.shadow.camera.far = 70;
          light.shadow.bias = -0.0004;
          const d = 22;
          light.shadow.camera.left = -d;
          light.shadow.camera.right = d;
          light.shadow.camera.top = d;
          light.shadow.camera.bottom = -d;
        }
        scene.add(light);
        break;
      }
      case "point": {
        const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance, spec.decay);
        light.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
        scene.add(light);
        break;
      }
    }
  }
}

/**
 * A short, stable signature of the shared lighting + fog config. Folded into the
 * thumbnail cache hash so editing any value above re-renders cached previews.
 */
export function studioLightingSignature(): string {
  return JSON.stringify({ fog: STUDIO_FOG, lights: STUDIO_LIGHTS });
}
