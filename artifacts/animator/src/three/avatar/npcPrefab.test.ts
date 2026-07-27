import { describe, expect, it } from "vitest";
import { decodeConfig, encodeConfig, randomConfig } from "./catalog";
import {
  decodePrefab,
  encodePrefab,
  generatePrefab,
  generateSquad,
  makePrefabFromFace,
  raceHeightM,
} from "./npcPrefab";

describe("npcPrefab", () => {
  it("round-trips AVP1 prefab codes with face + loadout", () => {
    const face = randomConfig("barbarian", () => 0.42);
    const prefab = makePrefabFromFace(face, "enemy", {
      heightScale: 1.15,
      armorSetId: "iron",
      weaponId: "none",
      name: "Test Brute",
    });
    const code = encodePrefab(prefab);
    expect(code.startsWith("AVP1.")).toBe(true);
    const back = decodePrefab(code);
    expect(back).not.toBeNull();
    expect(back!.face.race).toBe("barbarian");
    expect(back!.role).toBe("enemy");
    expect(back!.heightScale).toBeCloseTo(1.15, 2);
    expect(back!.name).toBe("Test Brute");
  });

  it("promotes AV1 face codes to prefab shells", () => {
    const face = randomConfig("human", () => 0.2);
    const av1 = encodeConfig(face);
    expect(av1.startsWith("AV1.")).toBe(true);
    const p = decodePrefab(av1);
    expect(p?.face.race).toBe("human");
    expect(decodeConfig(av1)?.race).toBe(p!.face.race);
  });

  it("generates role squads", () => {
    const squad = generateSquad(4, ["ally", "enemy", "vendor", "boss"], () => 0.3);
    expect(squad).toHaveLength(4);
    expect(squad.map((s) => s.role)).toEqual(["ally", "enemy", "vendor", "boss"]);
  });

  it("maps race height in SI metres", () => {
    expect(raceHeightM("human", 1)).toBeCloseTo(1.8, 5);
    expect(raceHeightM("dwarf", 1)).toBeCloseTo(1.55, 5);
    expect(raceHeightM("barbarian", 1.2)).toBeCloseTo(2.4, 5);
  });

  it("generatePrefab returns valid enemy kit", () => {
    const p = generatePrefab("enemy", "orc", () => 0.55);
    expect(p.role).toBe("enemy");
    expect(p.face.race).toBe("orc");
    expect(p.tags).toContain("generated");
  });
});
