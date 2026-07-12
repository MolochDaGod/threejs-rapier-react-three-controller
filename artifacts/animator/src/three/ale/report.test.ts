import { describe, it, expect } from "vitest";
import {
  buildAleReport,
  emptyFighterTelemetry,
  type AleTelemetry,
  type FighterTelemetry,
} from "./report";

/**
 * `buildAleReport` is the pure aggregator behind the post-duel A.L.E. report.
 * Its findings (balance / timing / physics) and per-fighter stats drive what a
 * designer sees, so this suite locks in the math: accuracy, damage-share skew,
 * KO-lead, time-to-kill stats, missing-collider/force flags, and the
 * severity-sorted finding ranking.
 */

function fighter(overrides: Partial<FighterTelemetry> = {}): FighterTelemetry {
  return { ...emptyFighterTelemetry(), ...overrides };
}

function telemetry(overrides: Partial<AleTelemetry> = {}): AleTelemetry {
  return {
    rounds: 1,
    timeToKill: [],
    a: emptyFighterTelemetry(),
    b: emptyFighterTelemetry(),
    ...overrides,
  };
}

const findingTexts = (data: ReturnType<typeof buildAleReport>) =>
  data.findings.map((f) => f.text).join("\n");

describe("buildAleReport — per-fighter aggregation", () => {
  it("computes accuracy as hits / swings and copies raw counters through", () => {
    const data = buildAleReport(
      telemetry({
        a: fighter({ swings: 10, hits: 7, whiffs: 3, blocks: 2, parries: 1, dodges: 4, damageDealt: 50 }),
      }),
    );
    const a = data.fighters.find((f) => f.fighter === "A")!;
    expect(a.accuracy).toBeCloseTo(0.7);
    expect(a.hits).toBe(7);
    expect(a.whiffs).toBe(3);
    expect(a.blocks).toBe(2);
    expect(a.parries).toBe(1);
    expect(a.dodges).toBe(4);
    expect(a.damageDealt).toBe(50);
  });

  it("treats accuracy as 0 when a fighter never swung (no divide-by-zero)", () => {
    const data = buildAleReport(telemetry());
    for (const f of data.fighters) expect(f.accuracy).toBe(0);
  });

  it("exposes both fighters labelled A and B", () => {
    const data = buildAleReport(telemetry());
    expect(data.fighters.map((f) => f.fighter)).toEqual(["A", "B"]);
  });

  it("echoes rounds and a defensive copy of timeToKill", () => {
    const ttk = [4, 5, 6];
    const data = buildAleReport(telemetry({ rounds: 3, timeToKill: ttk }));
    expect(data.rounds).toBe(3);
    expect(data.timeToKill).toEqual([4, 5, 6]);
    expect(data.timeToKill).not.toBe(ttk);
  });
});

describe("buildAleReport — balanced vs lopsided", () => {
  it("reports a clean matchup when nothing is out of bounds", () => {
    const data = buildAleReport(
      telemetry({
        rounds: 2,
        timeToKill: [10, 11],
        a: fighter({ swings: 10, hits: 8, damageDealt: 100, kos: 1 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 100, kos: 1 }),
      }),
    );
    expect(data.findings).toHaveLength(1);
    expect(data.findings[0].severity).toBe(0);
    expect(data.findings[0].text).toMatch(/reads clean/i);
  });

  it("flags lopsided damage output with the leading fighter and a share %", () => {
    const data = buildAleReport(
      telemetry({
        a: fighter({ swings: 10, hits: 8, damageDealt: 90 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 10 }),
      }),
    );
    const balance = data.findings.find((f) => f.category === "balance");
    expect(balance).toBeDefined();
    expect(balance!.text).toContain("fighter A");
    expect(balance!.text).toContain("90%");
  });

  it("does NOT flag damage balance when the split is within the 20% skew band", () => {
    // A has 65% of damage → skew 0.15, under the 0.2 threshold.
    const data = buildAleReport(
      telemetry({
        a: fighter({ swings: 10, hits: 8, damageDealt: 65 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 35 }),
      }),
    );
    expect(findingTexts(data)).not.toMatch(/lopsided/i);
  });

  it("names fighter B as the lead when B out-damages A", () => {
    const data = buildAleReport(
      telemetry({
        a: fighter({ swings: 10, hits: 8, damageDealt: 10 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 90 }),
      }),
    );
    const balance = data.findings.find((f) => f.category === "balance")!;
    expect(balance.text).toContain("fighter B");
    expect(balance.text).toContain("90%");
  });

  it("scales damage-skew severity with how lopsided it is", () => {
    const mild = buildAleReport(
      telemetry({
        a: fighter({ swings: 10, hits: 8, damageDealt: 75 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 25 }),
      }),
    ).findings.find((f) => f.category === "balance")!;
    const severe = buildAleReport(
      telemetry({
        a: fighter({ swings: 10, hits: 8, damageDealt: 99 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 1 }),
      }),
    ).findings.find((f) => f.category === "balance")!;
    expect(severe.severity).toBeGreaterThan(mild.severity);
  });
});

describe("buildAleReport — KO / round-win balance", () => {
  it("flags a KO lead only across 2+ rounds", () => {
    const data = buildAleReport(
      telemetry({
        rounds: 3,
        a: fighter({ swings: 10, hits: 8, damageDealt: 100, kos: 2 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 100, kos: 0 }),
      }),
    );
    const koFinding = data.findings.find((f) => f.text.includes("Round wins"));
    expect(koFinding).toBeDefined();
    expect(koFinding!.text).toContain("fighter A");
    expect(koFinding!.text).toContain("2–0");
  });

  it("does NOT flag a KO lead from a single round", () => {
    const data = buildAleReport(
      telemetry({
        rounds: 1,
        a: fighter({ swings: 10, hits: 8, damageDealt: 100, kos: 1 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 100, kos: 0 }),
      }),
    );
    expect(findingTexts(data)).not.toMatch(/Round wins/);
  });
});

describe("buildAleReport — timing findings", () => {
  it("flags heavy whiffing when accuracy < 35% over 4+ swings", () => {
    const data = buildAleReport(
      telemetry({
        a: fighter({ swings: 10, hits: 2, whiffs: 8, damageDealt: 50 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 50 }),
      }),
    );
    const timing = data.findings.find((f) => f.category === "timing" && f.text.includes("whiffed"));
    expect(timing).toBeDefined();
    expect(timing!.text).toContain("Fighter A");
    expect(timing!.text).toContain("20%");
  });

  it("does NOT flag whiffing below the 4-swing minimum sample", () => {
    const data = buildAleReport(
      telemetry({
        a: fighter({ swings: 3, hits: 0, whiffs: 3, damageDealt: 50 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 50 }),
      }),
    );
    expect(findingTexts(data)).not.toMatch(/whiffed/);
  });

  it("flags missing-collider frames as a timing/contact mismatch", () => {
    const data = buildAleReport(
      telemetry({
        a: fighter({ swings: 10, hits: 8, damageDealt: 50, missingColliderFlags: 3 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 50 }),
      }),
    );
    const f = data.findings.find((x) => x.text.includes("hit volume"));
    expect(f).toBeDefined();
    expect(f!.category).toBe("timing");
    expect(f!.text).toContain("3 fast");
  });

  it("flags rounds that end very fast (avg ttk < 3s)", () => {
    const data = buildAleReport(
      telemetry({
        timeToKill: [1, 2],
        a: fighter({ swings: 10, hits: 8, damageDealt: 100 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 100 }),
      }),
    );
    const f = data.findings.find((x) => x.text.includes("very fast"));
    expect(f).toBeDefined();
    expect(f!.text).toContain("1.5s");
  });

  it("flags rounds that drag on (avg ttk > 25s)", () => {
    const data = buildAleReport(
      telemetry({
        timeToKill: [30, 40],
        a: fighter({ swings: 10, hits: 8, damageDealt: 100 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 100 }),
      }),
    );
    const f = data.findings.find((x) => x.text.includes("drag on"));
    expect(f).toBeDefined();
    expect(f!.text).toContain("35s");
  });

  it("does NOT flag a healthy time-to-kill in the 3–25s band", () => {
    const data = buildAleReport(
      telemetry({
        timeToKill: [10, 12],
        a: fighter({ swings: 10, hits: 8, damageDealt: 100 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 100 }),
      }),
    );
    const texts = findingTexts(data);
    expect(texts).not.toMatch(/very fast/);
    expect(texts).not.toMatch(/drag on/);
  });
});

describe("buildAleReport — physics findings", () => {
  it("flags an exaggerated force spike above the threshold", () => {
    const data = buildAleReport(
      telemetry({
        a: fighter({ swings: 10, hits: 8, damageDealt: 100, peakForce: 12, forceSpikes: 4 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 100 }),
      }),
    );
    const f = data.findings.find((x) => x.category === "physics");
    expect(f).toBeDefined();
    expect(f!.text).toContain("12");
    expect(f!.text).toContain("4 spike");
  });

  it("does NOT flag force at or below the threshold", () => {
    const data = buildAleReport(
      telemetry({
        a: fighter({ swings: 10, hits: 8, damageDealt: 100, peakForce: 8, forceSpikes: 1 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 100 }),
      }),
    );
    expect(data.findings.some((f) => f.category === "physics")).toBe(false);
  });
});

describe("buildAleReport — finding ranking", () => {
  it("sorts findings most-severe first", () => {
    const data = buildAleReport(
      telemetry({
        rounds: 3,
        timeToKill: [1, 1],
        a: fighter({ swings: 10, hits: 2, whiffs: 8, damageDealt: 99, peakForce: 30, forceSpikes: 5, kos: 3, missingColliderFlags: 5 }),
        b: fighter({ swings: 10, hits: 8, damageDealt: 1, kos: 0 }),
      }),
    );
    expect(data.findings.length).toBeGreaterThan(1);
    const severities = data.findings.map((f) => f.severity);
    const sorted = [...severities].sort((x, y) => y - x);
    expect(severities).toEqual(sorted);
  });
});
