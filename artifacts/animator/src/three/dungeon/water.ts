/**
 * Pure decision logic for the vertical dungeon's water layer.
 *
 * The water descent (surface map → sealed pit → boss) is otherwise entangled
 * with WebGL/Rapier/GLTF code that can't run in the headless test sandbox, so
 * the three feel-critical decisions — the buoyancy sink clamp, the swim/ground
 * traversal toggle, and the enter/exit zone reset — live here as plain functions
 * with no renderer/physics dependency. Both {@link Controller} and {@link Studio}
 * call into these so the unit tests guard the real behaviour.
 */

/** A vertical band [bottom, top] in world Y that the player descends through. */
export interface WaterBand {
  top: number;
  bottom: number;
}

/**
 * The "no water" band — used in the Danger Room and after exiting the dungeon.
 * Inverted bounds (top below bottom) make {@link isInWaterBand} false for every
 * finite Y, so the body always falls under normal gravity.
 */
export const NO_WATER_BAND: WaterBand = { top: -Infinity, bottom: Infinity };

/** True while the body's feet Y are within the active water band. */
export function isInWaterBand(y: number, band: WaterBand): boolean {
  return y <= band.top && y >= band.bottom;
}

/**
 * Buoyancy clamp for the descent: while the feet are inside the band, clamp a
 * fast downward velocity to a slow constant sink so the player drifts down
 * through the water rather than plummeting. Upward (jump/climb) velocity and any
 * descent already slower than the sink speed are left untouched, and outside the
 * band the velocity passes through unchanged.
 */
export function sinkClampVertical(
  y: number,
  vertical: number,
  band: WaterBand,
  sinkSpeed: number,
): number {
  if (isInWaterBand(y, band) && vertical < -sinkSpeed) return -sinkSpeed;
  return vertical;
}

/** Swim only while inside the water band; ground locomotion otherwise. */
export function traversalModeFor(y: number, band: WaterBand): "swim" | "ground" {
  return isInWaterBand(y, band) ? "swim" : "ground";
}

/**
 * The canonical "back in the Danger Room" zone state. Exiting the dungeon (via
 * the door or on death) and entering it must converge on this when leaving: no
 * water band, ground traversal, no dungeon collision/occluders, and the Danger
 * Room sparring population visible again. Guards against leftover wrong-zone
 * state bleeding from one zone into the next.
 */
export interface DungeonZoneState {
  waterBand: WaterBand;
  traversalMode: "swim" | "ground";
  /** Active world-collision provider; null = flat Danger Room floor + bounds. */
  hasCollision: boolean;
  /** Camera occluder count handed to the Controller. */
  occluderCount: number;
  /** Whether the Danger Room sparring population is shown. */
  populationVisible: boolean;
}

/** The state the Controller + Studio must return to when leaving the dungeon. */
export const DANGER_ROOM_ZONE: DungeonZoneState = {
  waterBand: NO_WATER_BAND,
  traversalMode: "ground",
  hasCollision: false,
  occluderCount: 0,
  populationVisible: true,
};
