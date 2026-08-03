import { describe, expect, it } from "vitest";
import {
  buildRaceDefault,
  buildRaceDefaultsManifest,
  listRaceDefaults,
  raceDefault,
} from "./raceDefaults";
import { RACES, decodeConfig, sanitizeConfig } from "./catalog";
import { composeHead } from "./composeHead";

describe("voxel race defaults (Avatar Edit)", () => {
  it("ships exactly the 6 catalog races", () => {
    const list = listRaceDefaults();
    expect(list.map((r) => r.id)).toEqual(RACES.map((r) => r.id));
    expect(list).toHaveLength(6);
  });

  it("each default has fleet ids, look, height, and a valid config", () => {
    for (const race of listRaceDefaults()) {
      expect(race.kind).toBe("voxel-avatar-race");
      expect(race.renderPipeline).toBe("voxel");
      expect(race.avatarId).toBe(`avatar-${race.id}`);
      expect(race.look.avatarHead).toBe(true);
      expect(race.look.skin.startsWith("#")).toBe(true);
      expect(race.heightM).toBeGreaterThan(1);
      expect(race.heightM).toBeLessThan(2.5);
      const cfg = sanitizeConfig(race.config);
      expect(cfg?.race).toBe(race.id);
      expect(decodeConfig(race.code)?.race).toBe(race.id);
      // Head must compose (opaque faces) so games can render without extra assets
      const head = composeHead(race.config);
      expect(head.faces.front.length).toBe(16 * 16);
    }
  });

  it("manifest is versioned for CDN fetch", () => {
    const m = buildRaceDefaultsManifest();
    expect(m.version).toBe(1);
    expect(m.kind).toBe("voxel-avatar-race-defaults");
    expect(m.races).toHaveLength(6);
    expect(raceDefault("orc").config.tusks).toBe("big");
    expect(buildRaceDefault("dwarf").heightM).toBe(1.5);
  });
});
