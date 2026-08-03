/**
 * Kenney Prototype Kit catalog for Danger Room camp lab.
 * Assets staged under `public/models/kenney/prototype/` (from
 * `D:/Games/Models/kenney_prototype-kit`). 1 m grid · kenney-build skill SSOT.
 */

export type KenneyCategory = "floor" | "wall" | "column" | "stairs" | "prop";

export interface KenneyPieceDef {
  /** Stable id (= glb stem). */
  id: string;
  label: string;
  category: KenneyCategory;
  /** Relative URL under public/ (no leading slash). */
  glb: string;
  /** Footprint on 1 m grid (cells). */
  sizeX: number;
  sizeZ: number;
  /** Approx visual height (m) for ghost / collider. */
  height: number;
  cost: { wood: number; stone: number };
  /** SI scale applied after load (kit is ~1 m modular). */
  scale: number;
}

const P = "models/kenney/prototype";

/** Curated production subset staged into this app (not full 145-piece kit). */
export const KENNEY_CATALOG: readonly KenneyPieceDef[] = [
  {
    id: "floor-square",
    label: "Floor",
    category: "floor",
    glb: `${P}/floor-square.glb`,
    sizeX: 1,
    sizeZ: 1,
    height: 0.15,
    cost: { wood: 2, stone: 1 },
    scale: 1,
  },
  {
    id: "floor-small-square",
    label: "Floor S",
    category: "floor",
    glb: `${P}/floor-small-square.glb`,
    sizeX: 1,
    sizeZ: 1,
    height: 0.12,
    cost: { wood: 1, stone: 1 },
    scale: 1,
  },
  {
    id: "floor-thick",
    label: "Floor Thick",
    category: "floor",
    glb: `${P}/floor-thick.glb`,
    sizeX: 1,
    sizeZ: 1,
    height: 0.35,
    cost: { wood: 2, stone: 2 },
    scale: 1,
  },
  {
    id: "wall",
    label: "Wall",
    category: "wall",
    glb: `${P}/wall.glb`,
    sizeX: 1,
    sizeZ: 0.25,
    height: 1.4,
    cost: { wood: 2, stone: 1 },
    scale: 1,
  },
  {
    id: "wall-low",
    label: "Wall Low",
    category: "wall",
    glb: `${P}/wall-low.glb`,
    sizeX: 1,
    sizeZ: 0.25,
    height: 0.7,
    cost: { wood: 1, stone: 1 },
    scale: 1,
  },
  {
    id: "wall-corner",
    label: "Wall Corner",
    category: "wall",
    glb: `${P}/wall-corner.glb`,
    sizeX: 1,
    sizeZ: 1,
    height: 1.4,
    cost: { wood: 3, stone: 1 },
    scale: 1,
  },
  {
    id: "wall-doorway",
    label: "Doorway",
    category: "wall",
    glb: `${P}/wall-doorway.glb`,
    sizeX: 1,
    sizeZ: 0.3,
    height: 1.5,
    cost: { wood: 3, stone: 2 },
    scale: 1,
  },
  {
    id: "wall-doorway-wide",
    label: "Door Wide",
    category: "wall",
    glb: `${P}/wall-doorway-wide.glb`,
    sizeX: 2,
    sizeZ: 0.3,
    height: 1.5,
    cost: { wood: 4, stone: 2 },
    scale: 1,
  },
  {
    id: "wall-window-small",
    label: "Window S",
    category: "wall",
    glb: `${P}/wall-window-small.glb`,
    sizeX: 1,
    sizeZ: 0.25,
    height: 1.4,
    cost: { wood: 2, stone: 2 },
    scale: 1,
  },
  {
    id: "wall-window-medium",
    label: "Window M",
    category: "wall",
    glb: `${P}/wall-window-medium.glb`,
    sizeX: 1,
    sizeZ: 0.25,
    height: 1.4,
    cost: { wood: 2, stone: 2 },
    scale: 1,
  },
  {
    id: "column",
    label: "Column",
    category: "column",
    glb: `${P}/column.glb`,
    sizeX: 0.4,
    sizeZ: 0.4,
    height: 1.8,
    cost: { wood: 1, stone: 2 },
    scale: 1,
  },
  {
    id: "column-low",
    label: "Column Low",
    category: "column",
    glb: `${P}/column-low.glb`,
    sizeX: 0.4,
    sizeZ: 0.4,
    height: 0.9,
    cost: { wood: 1, stone: 1 },
    scale: 1,
  },
  {
    id: "column-rounded",
    label: "Column Round",
    category: "column",
    glb: `${P}/column-rounded.glb`,
    sizeX: 0.45,
    sizeZ: 0.45,
    height: 1.8,
    cost: { wood: 1, stone: 2 },
    scale: 1,
  },
  {
    id: "stairs",
    label: "Stairs",
    category: "stairs",
    glb: `${P}/stairs.glb`,
    sizeX: 1,
    sizeZ: 1,
    height: 1,
    cost: { wood: 3, stone: 2 },
    scale: 1,
  },
  {
    id: "stairs-small",
    label: "Stairs S",
    category: "stairs",
    glb: `${P}/stairs-small.glb`,
    sizeX: 1,
    sizeZ: 1,
    height: 0.8,
    cost: { wood: 2, stone: 2 },
    scale: 1,
  },
  {
    id: "stairs-narrow",
    label: "Stairs Narrow",
    category: "stairs",
    glb: `${P}/stairs-narrow.glb`,
    sizeX: 0.5,
    sizeZ: 1,
    height: 1,
    cost: { wood: 2, stone: 1 },
    scale: 1,
  },
  {
    id: "crate",
    label: "Crate",
    category: "prop",
    glb: `${P}/crate.glb`,
    sizeX: 0.6,
    sizeZ: 0.6,
    height: 0.6,
    cost: { wood: 2, stone: 0 },
    scale: 1,
  },
] as const;

export function kenneyById(id: string): KenneyPieceDef | undefined {
  return KENNEY_CATALOG.find((p) => p.id === id);
}

export function kenneyByCategory(cat: KenneyCategory): KenneyPieceDef[] {
  return KENNEY_CATALOG.filter((p) => p.category === cat);
}

/** Blueprint browser row for HUD. */
export function kenneyBrowserRows(): Array<{
  id: string;
  label: string;
  category: KenneyCategory;
  wood: number;
  stone: number;
}> {
  return KENNEY_CATALOG.map((p) => ({
    id: p.id,
    label: p.label,
    category: p.category,
    wood: p.cost.wood,
    stone: p.cost.stone,
  }));
}
