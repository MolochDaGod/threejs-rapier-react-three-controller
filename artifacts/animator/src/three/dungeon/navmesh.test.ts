import { describe, it, expect } from "vitest";
import {
  makeGrid,
  findPath,
  worldToCell,
  cellCenter,
  isWalkable,
  nearestWalkable,
  groundProbeAt,
  type NavGrid,
} from "./navmesh";

/** Build a grid from an ASCII map. '#' = blocked, '.' = walkable (height 0). */
function fromAscii(rowsAscii: string[], cell = 1): NavGrid {
  const rows = rowsAscii.length;
  const cols = rowsAscii[0].length;
  const g = makeGrid(cols, rows, cell, 0, 0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.walkable[r * cols + c] = rowsAscii[r][c] === "#" ? 0 : 1;
    }
  }
  return g;
}

describe("navmesh coordinate math", () => {
  it("round-trips world<->cell at cell centres", () => {
    const g = makeGrid(10, 10, 0.5, -2, -3);
    for (const [c, r] of [
      [0, 0],
      [3, 7],
      [9, 9],
    ]) {
      const w = cellCenter(g, c, r);
      const back = worldToCell(g, w.x, w.z);
      expect(back).toEqual({ c, r });
    }
  });

  it("nearestWalkable finds an adjacent open cell", () => {
    const g = fromAscii(["...", ".#.", "..."]);
    expect(nearestWalkable(g, 1, 1)).not.toBeNull();
    expect(isWalkable(g, ...Object.values(nearestWalkable(g, 1, 1)!) as [number, number])).toBe(true);
  });
});

describe("findPath A*", () => {
  it("returns a path through open terrain", () => {
    const g = fromAscii(["....", "....", "....", "...."]);
    const path = findPath(g, 0, 0, 3, 3);
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1];
    expect(worldToCell(g, last.x, last.z)).toEqual({ c: 3, r: 3 });
  });

  it("routes around a wall instead of through it", () => {
    // A vertical wall in column 2 with a gap at the bottom row.
    const g = fromAscii([
      "..#..",
      "..#..",
      "..#..",
      "..#..",
      ".....",
    ]);
    const path = findPath(g, 0, 0, 4, 0);
    expect(path.length).toBeGreaterThan(0);
    // No waypoint may land on a blocked cell.
    for (const wp of path) {
      const { c, r } = worldToCell(g, wp.x, wp.z);
      expect(isWalkable(g, c, r)).toBe(true);
    }
    // It must use the gap row (row 4) to cross column 2.
    const crossed = path.some((wp) => {
      const { c, r } = worldToCell(g, wp.x, wp.z);
      return c === 2 && r === 4;
    });
    expect(crossed).toBe(true);
  });

  it("returns empty when the goal is walled off", () => {
    const g = fromAscii([
      ".....",
      ".....",
      "#####",
      ".....",
      ".....",
    ]);
    const path = findPath(g, 0, 0, 0, 4);
    expect(path).toEqual([]);
  });

  it("does not cut blocked diagonal corners", () => {
    // Moving from (0,0) toward (1,1) must not pass diagonally between the two
    // walls at (1,0) and (0,1).
    const g = fromAscii([".#", "#."]);
    const path = findPath(g, 0, 0, 1, 1);
    // (1,1) is isolated by the corner rule -> no path.
    expect(path).toEqual([]);
  });

  it("carries floor height into the waypoints", () => {
    const g = fromAscii(["..", ".."]);
    // Give cell (1,1) a raised floor (a step).
    g.height[1 * 2 + 1] = 2.5;
    const path = findPath(g, 0, 0, 1, 1);
    const last = path[path.length - 1];
    expect(last.y).toBeCloseTo(2.5, 5);
  });
});

describe("groundProbeAt", () => {
  it("returns the cell height and a straight-up normal on flat floor", () => {
    const g = fromAscii(["...", "...", "..."]); // all height 0
    const p = groundProbeAt(g, 1, 1);
    expect(p.hit).toBe(true);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.nx).toBeCloseTo(0, 6);
    expect(p.ny).toBeCloseTo(1, 6);
    expect(p.nz).toBeCloseTo(0, 6);
  });

  it("tilts the normal down-slope along +x as the floor rises in +x", () => {
    const g = fromAscii(["...", "...", "..."], 1);
    // Rising ramp along +x: column c contributes height = c.
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g.height[r * 3 + c] = c;
    const p = groundProbeAt(g, 1, 1); // centre cell (1,1)
    expect(p.hit).toBe(true);
    expect(p.y).toBeCloseTo(1, 6);
    // dY/dx = +1 → normal leans toward -x; z is unaffected; still unit length.
    expect(p.nx).toBeLessThan(0);
    expect(p.nz).toBeCloseTo(0, 6);
    expect(Math.hypot(p.nx, p.ny, p.nz)).toBeCloseTo(1, 6);
  });

  it("reports a miss and the fallback height off the navmesh", () => {
    const g = fromAscii([".#", ".."]);
    const p = groundProbeAt(g, 1, 0, -99); // cell (1,0) is blocked
    expect(p.hit).toBe(false);
    expect(p.y).toBe(-99);
  });

  it("reads flat (up normal) at a wall edge instead of a cliff", () => {
    // A walkable strip beside a blocked column: a neighbour falls back to the
    // centre height, so the slope reads zero rather than a huge drop.
    const g = fromAscii(["..#", "..#", "..#"], 1);
    const p = groundProbeAt(g, 1, 1); // walkable, neighbour (2,1) is blocked
    expect(p.hit).toBe(true);
    expect(p.ny).toBeCloseTo(1, 6);
  });
});
