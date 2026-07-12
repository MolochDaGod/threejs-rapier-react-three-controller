import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, PERSISTENT_ROOMS, PERSISTENT_ROOM_MAX_PLAYERS } from "./types";

describe("PERSISTENT_ROOMS", () => {
  it("defines the named Danger Room and Colosseum lobbies", () => {
    const byName = new Map(PERSISTENT_ROOMS.map((r) => [r.name, r]));
    expect(byName.get("Danger Room")?.preset).toBe("holo");
    expect(byName.get("Colosseum")?.preset).toBe("colosseum");
  });

  it("caps every official lobby at 4 players", () => {
    expect(PERSISTENT_ROOM_MAX_PLAYERS).toBe(4);
    for (const room of PERSISTENT_ROOMS) {
      expect(room.maxPlayers).toBe(4);
    }
  });

  it("keeps the official cap below the ad-hoc room ceiling", () => {
    expect(PERSISTENT_ROOM_MAX_PLAYERS).toBeLessThan(MAX_PLAYERS);
  });

  it("uses unique, non-empty, uppercase join codes", () => {
    const codes = PERSISTENT_ROOMS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code.length).toBeGreaterThan(0);
      expect(code).toBe(code.toUpperCase());
    }
  });

  it("only uses known room modes", () => {
    for (const room of PERSISTENT_ROOMS) {
      expect(["coop", "pvp"]).toContain(room.mode);
    }
  });
});
