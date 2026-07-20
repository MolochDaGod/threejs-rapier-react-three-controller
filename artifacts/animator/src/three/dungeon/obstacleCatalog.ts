/**
 * Mobile-game obstacles multipack — dungeon traps + buildable defense catalog.
 * Model: public/models/obstacles/mobile_game_obstacles.glb (PBR-upgraded).
 */

export const MOBILE_OBSTACLES_MODEL = "models/obstacles/mobile_game_obstacles.glb";

export interface ObstaclePieceDef {
  id: string;
  nodeName: string;
  label: string;
  scale: number;
  hazardRadius: number;
  damage: number;
  /** 0 = one-shot (bomb) */
  tickSec: number;
  animate: "spin_y" | "bob_y" | "none";
  /** Solid collision for cylinders / gears (not floors) */
  solid: boolean;
}

export const OBSTACLE_PIECES: Record<string, ObstaclePieceDef> = {
  trap_spike: {
    id: "trap_spike",
    nodeName: "spike-obstacle_8",
    label: "Spike Trap",
    scale: 1.2,
    hazardRadius: 1.1,
    damage: 18,
    tickSec: 0.9,
    animate: "none",
    solid: false,
  },
  trap_spike_tall: {
    id: "trap_spike_tall",
    nodeName: "spike-obstacle.002_11",
    label: "Rising Spikes",
    scale: 1.25,
    hazardRadius: 1.0,
    damage: 22,
    tickSec: 0.75,
    animate: "bob_y",
    solid: false,
  },
  trap_cylinder: {
    id: "trap_cylinder",
    nodeName: "CylinderObstacle_6",
    label: "Spinning Barrel",
    scale: 1.15,
    hazardRadius: 1.35,
    damage: 14,
    tickSec: 0.55,
    animate: "spin_y",
    solid: true,
  },
  trap_gear: {
    id: "trap_gear",
    nodeName: "gear-base_7",
    label: "Gear Crusher",
    scale: 1.1,
    hazardRadius: 1.5,
    damage: 20,
    tickSec: 0.65,
    animate: "spin_y",
    solid: true,
  },
  trap_bomb: {
    id: "trap_bomb",
    nodeName: "Bomb_5",
    label: "Bomb Mine",
    scale: 1.05,
    hazardRadius: 2.2,
    damage: 45,
    tickSec: 0,
    animate: "none",
    solid: false,
  },
  trap_spiral: {
    id: "trap_spiral",
    nodeName: "SpiralBase_15",
    label: "Spiral Plate",
    scale: 1.05,
    hazardRadius: 1.4,
    damage: 8,
    tickSec: 1.0,
    animate: "spin_y",
    solid: false,
  },
  trap_spike_base: {
    id: "trap_spike_base",
    nodeName: "SpikeBase_16",
    label: "Spike Plate",
    scale: 1.05,
    hazardRadius: 1.6,
    damage: 16,
    tickSec: 0.85,
    animate: "none",
    solid: false,
  },
  trap_grid: {
    id: "trap_grid",
    nodeName: "GridGround_4",
    label: "Hazard Grid",
    scale: 1.0,
    hazardRadius: 1.2,
    damage: 10,
    tickSec: 1.1,
    animate: "none",
    solid: false,
  },
};

export const DUNGEON_TRAP_POOL: Array<{ pieceId: string; weight: number }> = [
  { pieceId: "trap_spike", weight: 4 },
  { pieceId: "trap_spike_tall", weight: 3 },
  { pieceId: "trap_cylinder", weight: 3 },
  { pieceId: "trap_gear", weight: 2 },
  { pieceId: "trap_bomb", weight: 2 },
  { pieceId: "trap_spiral", weight: 2 },
  { pieceId: "trap_spike_base", weight: 2 },
  { pieceId: "trap_grid", weight: 1 },
];

export function dungeonTrapCounts(seed: number): { surface: number; pit: number } {
  const s = Math.abs(seed | 0);
  return { surface: 10 + (s % 7), pit: 4 + (s % 4) };
}

export function pickWeighted(
  pool: Array<{ pieceId: string; weight: number }>,
  rand: () => number,
): string {
  let total = 0;
  for (const p of pool) total += p.weight;
  let r = rand() * total;
  for (const p of pool) {
    r -= p.weight;
    if (r <= 0) return p.pieceId;
  }
  return pool[0]?.pieceId ?? "trap_spike";
}

export function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
