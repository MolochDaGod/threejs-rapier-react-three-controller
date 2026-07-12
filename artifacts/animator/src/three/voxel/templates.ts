import type {
  BlockData,
  DeployableData,
  Difficulty,
  PieceShape,
  VoxelMap,
} from "./types";
import { VOXEL_MAP_VERSION } from "./types";
import type { WeaponId } from "../types";

/**
 * Code-defined starting-map templates for the Voxel Editor. Picking one on entry
 * (or via "New Map") loads a ready-made layout so the user never starts on an
 * empty pad. Each template is pure data (BlockData/DeployableData) and ALWAYS
 * includes a player start so "Test" works immediately.
 *
 * No `@workspace/*` imports — this artifact is meant to be liftable on its own.
 */

/** Palette (matches the editor swatches) for readable, consistent template art. */
const C = {
  blue: 0x6ea8ff,
  green: 0x57d977,
  orange: 0xffb24d,
  red: 0xff5470,
  purple: 0xc79bff,
  canvas: 0xf4f1e8,
  grey: 0x9aa3b2,
  dark: 0x2c3340,
} as const;

/** Small fluent builder so each template reads like a level recipe. */
class MapBuilder {
  private blocks: BlockData[] = [];
  private deployables: DeployableData[] = [];
  /** Highest occupied block cell per "x,z" column, for auto-grounding. */
  private heights = new Map<string, number>();
  private n = 0;
  dungeon = false;

  /** Place a single piece at integer cell (x,y,z). */
  block(
    x: number,
    y: number,
    z: number,
    color: number,
    shape: PieceShape = "block",
    rotation = 0,
  ): this {
    this.blocks.push({ x, y, z, shape, color, rotation });
    const k = `${x},${z}`;
    this.heights.set(k, Math.max(this.heights.get(k) ?? -1, y));
    return this;
  }

  /**
   * The empty cell a deployable stands in at column (x,z): one above the tallest
   * terrain block there (or cell 0 on the bare ground plane). The editor grounds
   * a deployable on the TOP of the block BELOW its cell, so authoring at the
   * floor's own cell would bury it — this keeps every asset on its feet.
   */
  private groundCell(x: number, z: number): number {
    const h = this.heights.get(`${x},${z}`);
    return h === undefined ? 0 : h + 1;
  }

  /** Fill a solid rectangle of pieces on the X/Z plane at height `y`. */
  fill(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    color: number,
    shape: PieceShape = "block",
  ): this {
    const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
    for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) this.block(x, y, z, color, shape);
    return this;
  }

  /** Hollow rectangular border (one piece thick) at height `y`. */
  border(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    color: number,
    shape: PieceShape = "block",
  ): this {
    const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
    for (let x = ax; x <= bx; x++) {
      this.block(x, y, az, color, shape);
      this.block(x, y, bz, color, shape);
    }
    for (let z = az + 1; z < bz; z++) {
      this.block(ax, y, z, color, shape);
      this.block(bx, y, z, color, shape);
    }
    return this;
  }

  /** A vertical column of pieces from y0..y1 at (x,z). */
  column(x: number, z: number, y0: number, y1: number, color: number): this {
    for (let y = y0; y <= y1; y++) this.block(x, y, z, color);
    return this;
  }

  /** The (single) player start. `y` defaults to standing on the terrain here. */
  start(x: number, z: number, y?: number): this {
    this.deployables.push({
      id: `t${this.n++}`,
      kind: "start",
      x,
      y: y ?? this.groundCell(x, z),
      z,
      rotation: 0,
    });
    return this;
  }

  /** An armed NPC opponent. `y` defaults to standing on the terrain here. */
  npc(x: number, z: number, weapon: WeaponId, difficulty: Difficulty = "normal", y?: number): this {
    this.deployables.push({
      id: `t${this.n++}`,
      kind: "npc",
      x,
      y: y ?? this.groundCell(x, z),
      z,
      rotation: 0,
      weapon,
      difficulty,
    });
    return this;
  }

  /** A static training bag. `y` defaults to standing on the terrain here. */
  bag(x: number, z: number, physics = false, y?: number): this {
    this.deployables.push({
      id: `t${this.n++}`,
      kind: physics ? "physicsBag" : "heavyBag",
      x,
      y: y ?? this.groundCell(x, z),
      z,
      rotation: 0,
    });
    return this;
  }

  build(): VoxelMap {
    this.faceCombatants();
    return {
      version: VOXEL_MAP_VERSION,
      dungeon: this.dungeon,
      blocks: this.blocks,
      deployables: this.deployables,
    };
  }

  /**
   * Positional awareness: point each NPC at the player start and the start back
   * at the pack, so the editor preview reads as a staged fight instead of a row
   * of foes all staring the same way. `yaw` is a free Y-rotation (radians); the
   * rigs face +Z at yaw 0, so `atan2(dx, dz)` aims one at the other.
   */
  private faceCombatants(): void {
    const start = this.deployables.find((d) => d.kind === "start");
    if (!start) return;
    const npcs = this.deployables.filter((d) => d.kind === "npc");
    for (const n of npcs) n.yaw = Math.atan2(start.x - n.x, start.z - n.z);
    if (npcs.length) {
      const cx = npcs.reduce((s, n) => s + n.x, 0) / npcs.length;
      const cz = npcs.reduce((s, n) => s + n.z, 0) / npcs.length;
      start.yaw = Math.atan2(cx - start.x, cz - start.z);
    }
  }
}

// ── Templates ────────────────────────────────────────────────────────────────

/** A square canvas with corner posts and a rope-line border — a boxing ring. */
function boxingRing(): VoxelMap {
  const b = new MapBuilder();
  const r = 6; // half-width of the canvas
  b.fill(-r, -r, r, r, 0, C.canvas); // the mat
  b.border(-r, -r, r, r, 1, C.red); // rope line
  // Corner posts (3 high).
  for (const [x, z] of [
    [-r, -r],
    [r, -r],
    [-r, r],
    [r, r],
  ] as [number, number][]) {
    b.column(x, z, 1, 3, C.dark);
  }
  b.start(-3, 2);
  b.npc(3, -2, "none", "normal");
  return b.build();
}

/** A compact walled arena with a little cover and two foes. */
function arena1(): VoxelMap {
  const b = new MapBuilder();
  const r = 9;
  b.fill(-r, -r, r, r, 0, C.grey); // arena floor
  b.border(-r, -r, r, r, 1, C.dark); // low wall
  b.border(-r, -r, r, r, 2, C.dark);
  // A few scattered cover blocks.
  b.block(-3, 0, 3, C.blue).block(-3, 1, 3, C.blue);
  b.block(4, 0, -2, C.blue).block(4, 1, -2, C.blue);
  b.start(-6, -6);
  b.npc(5, 5, "sword", "normal");
  b.npc(-5, 5, "spear", "normal");
  return b.build();
}

/** A larger arena with center pillars and raised firing platforms. */
function arena2(): VoxelMap {
  const b = new MapBuilder();
  const r = 11;
  b.fill(-r, -r, r, r, 0, C.grey);
  b.border(-r, -r, r, r, 1, C.dark);
  b.border(-r, -r, r, r, 2, C.dark);
  // Four center pillars.
  for (const [x, z] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ] as [number, number][]) {
    b.column(x, z, 0, 3, C.purple);
  }
  // Raised corner platforms with ramps up.
  b.fill(-r, -r, -r + 3, -r + 3, 1, C.orange);
  b.block(-r + 4, 0, -r + 1, C.orange, "ramp", 1);
  b.fill(r - 3, r - 3, r, r, 1, C.orange);
  b.block(r - 4, 0, r - 1, C.orange, "ramp", 3);
  b.start(0, -8);
  b.npc(8, 8, "greatsword", "hard");
  b.npc(-8, 6, "bow", "normal");
  b.npc(6, -8, "axe", "normal");
  return b.build();
}

/** A big multi-level arena (custom dungeon) with elite opposition. */
function arena3(): VoxelMap {
  const b = new MapBuilder();
  b.dungeon = true;
  const r = 13;
  b.fill(-r, -r, r, r, 0, C.dark);
  b.border(-r, -r, r, r, 1, C.grey);
  b.border(-r, -r, r, r, 2, C.grey);
  b.border(-r, -r, r, r, 3, C.grey);
  // Central raised dais with a ramp.
  b.fill(-4, -4, 4, 4, 1, C.red);
  b.fill(-3, -3, 3, 3, 2, C.red);
  b.block(0, 0, 6, C.orange, "ramp", 0);
  b.block(0, 1, 5, C.orange, "ramp", 0);
  // Perimeter cover columns.
  for (const [x, z] of [
    [-9, 0],
    [9, 0],
    [0, -9],
    [0, 9],
  ] as [number, number][]) {
    b.column(x, z, 0, 2, C.purple);
  }
  b.start(0, -11);
  b.npc(0, 0, "greataxe", "elite", 3);
  b.npc(-9, 9, "sword", "hard");
  b.npc(9, 9, "spear", "hard");
  b.npc(9, -9, "bow", "normal");
  b.npc(-9, -9, "staff", "normal");
  return b.build();
}

/** A linear parkour run of platforms, gaps and ramps. */
function challenge1(): VoxelMap {
  const b = new MapBuilder();
  // Start pad.
  b.fill(-2, -10, 2, -8, 0, C.green);
  // Stepping platforms climbing toward the goal.
  b.fill(-1, -6, 1, -5, 1, C.blue);
  b.fill(-1, -3, 1, -2, 2, C.blue);
  b.fill(-1, 0, 1, 1, 3, C.blue);
  b.fill(-1, 3, 1, 4, 2, C.blue);
  b.fill(-1, 6, 1, 7, 1, C.blue);
  // Goal pad with a beacon column.
  b.fill(-2, 9, 2, 11, 0, C.orange);
  b.column(0, 10, 1, 4, C.red);
  b.start(0, -9);
  return b.build();
}

/** A harder course: narrow beams, higher jumps and switchbacks. */
function challenge2(): VoxelMap {
  const b = new MapBuilder();
  // Start pad.
  b.fill(-2, -11, 2, -9, 0, C.green);
  // Narrow beam (one cell wide).
  for (let z = -7; z <= -2; z++) b.block(0, 1, z, C.blue);
  // Switchback platforms at rising heights.
  b.fill(-6, 0, -3, 1, 2, C.purple);
  b.fill(3, 3, 6, 4, 3, C.purple);
  b.fill(-6, 6, -3, 7, 4, C.purple);
  // Ramp bridge to the goal.
  b.block(-2, 4, 8, C.orange, "ramp", 2);
  b.block(-1, 3, 8, C.orange, "ramp", 2);
  b.fill(-2, 9, 2, 11, 0, C.orange);
  b.column(0, 10, 1, 5, C.red);
  b.start(0, -10);
  return b.build();
}

/** Static metadata for a selectable starting-map template. */
export interface MapTemplate {
  id: string;
  label: string;
  desc: string;
  build: () => VoxelMap;
}

/** Selectable templates, in picker order. */
export const MAP_TEMPLATES: MapTemplate[] = [
  { id: "boxingRing", label: "Boxing Ring", desc: "Roped canvas + corner posts, 1-on-1", build: boxingRing },
  { id: "arena1", label: "Arena 1", desc: "Walled pit with light cover · 2 foes", build: arena1 },
  { id: "arena2", label: "Arena 2", desc: "Pillars + raised platforms · 3 foes", build: arena2 },
  { id: "arena3", label: "Arena 3", desc: "Multi-level dungeon · elite boss", build: arena3 },
  { id: "challenge1", label: "Challenge Course 1", desc: "Parkour platforms to the goal", build: challenge1 },
  { id: "challenge2", label: "Challenge Course 2", desc: "Narrow beams + switchbacks", build: challenge2 },
];
