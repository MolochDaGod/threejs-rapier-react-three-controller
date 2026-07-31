import { describe, expect, it } from "vitest";
import { randomConfig } from "./catalog";
import {
  buildProductionLoadout,
  prefabRoleToFaction,
  prefabToSpawnSpec,
  sanitizeProductionLoadout,
} from "./productionLoadout";
import { makePrefabFromFace } from "./npcPrefab";
import { loadoutFromSet } from "../equipment";

describe("productionLoadout", () => {
  it("builds a hydrate-ready blob from face + fit", () => {
    const face = randomConfig("elf", () => 0.33);
    const p = buildProductionLoadout({
      face,
      role: "ally",
      heightScale: 1.05,
      armorSetId: "iron",
      armorLoadout: loadoutFromSet("iron"),
      weaponId: "none",
    });
    expect(p.version).toBe(1);
    expect(p.face.race).toBe("elf");
    expect(p.faceCode.startsWith("AV1.")).toBe(true);
    expect(p.prefabCode.startsWith("AVP1.")).toBe(true);
    expect(p.heightM).toBeGreaterThan(1.5);
    expect(p.armorSetId).toBe("iron");
  });

  it("sanitizes stored JSON", () => {
    const face = randomConfig("human", () => 0.1);
    const built = buildProductionLoadout({ face, role: "player" });
    const again = sanitizeProductionLoadout(JSON.parse(JSON.stringify(built)));
    expect(again?.face.race).toBe("human");
    expect(again?.prefabCode.startsWith("AVP1.")).toBe(true);
  });

  it("maps AVP1 prefabs to Danger Room spawn specs", () => {
    const face = randomConfig("orc", () => 0.2);
    const enemy = makePrefabFromFace(face, "enemy", {
      weaponId: "axe",
      heightScale: 1.1,
    });
    const boss = makePrefabFromFace(face, "boss", {
      weaponId: "none",
      heightScale: 1.3,
    });
    const e = prefabToSpawnSpec(enemy);
    const b = prefabToSpawnSpec(boss);
    expect(prefabRoleToFaction("enemy")).toBe("enemy");
    expect(prefabRoleToFaction("ally")).toBe("ally");
    expect(e.faction).toBe("enemy");
    expect(e.weaponId).toBe("axe");
    expect(e.scale).toBeGreaterThan(0.9);
    expect(b.arch).toBe("boss");
    expect(b.weaponId).not.toBe("none");
    expect(b.scale).toBeGreaterThanOrEqual(1.55);
  });
});
