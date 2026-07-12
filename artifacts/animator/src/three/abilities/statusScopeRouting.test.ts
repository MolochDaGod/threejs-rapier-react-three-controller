import { describe, expect, it } from "vitest";
import { routeStatusScope } from "./statusScopeRouting";
import type { StatusScope } from "./abilityTypes";

const ally = { id: "ally" };
const hostile = { id: "hostile" };
const aoe = [{ id: "a1" }, { id: "a2" }];

describe("routeStatusScope", () => {
  it("self lands on the caster regardless of available targets", () => {
    expect(
      routeStatusScope("self", { selectedAlly: ally, selectedHostile: hostile, aoeAllies: aoe }),
    ).toEqual({ kind: "self" });
  });

  it("ally targets the selected ally", () => {
    expect(routeStatusScope("ally", { selectedAlly: ally })).toEqual({
      kind: "single",
      target: ally,
    });
  });

  it("ally falls back to self when no ally is selected", () => {
    expect(routeStatusScope("ally", { selectedAlly: null })).toEqual({ kind: "self" });
  });

  it("hostile targets the selected hostile", () => {
    expect(routeStatusScope("hostile", { selectedHostile: hostile })).toEqual({
      kind: "single",
      target: hostile,
    });
  });

  it("hostile falls back to self when no hostile is selected", () => {
    expect(routeStatusScope("hostile", { selectedHostile: null })).toEqual({ kind: "self" });
  });

  it("aoeAlly hits every ally in range", () => {
    expect(routeStatusScope("aoeAlly", { aoeAllies: aoe })).toEqual({
      kind: "aoe",
      targets: aoe,
    });
  });

  it("aoeAlly falls back to the selected ally when no allies are in range", () => {
    expect(routeStatusScope("aoeAlly", { aoeAllies: [], selectedAlly: ally })).toEqual({
      kind: "single",
      target: ally,
    });
  });

  it("aoeAlly falls back to self when no allies in range and none selected", () => {
    expect(routeStatusScope("aoeAlly", { aoeAllies: [], selectedAlly: null })).toEqual({
      kind: "self",
    });
  });

  it("hostile ignores ally/aoe candidates (no cross-scope leakage)", () => {
    expect(
      routeStatusScope("hostile", { selectedAlly: ally, aoeAllies: aoe, selectedHostile: null }),
    ).toEqual({ kind: "self" });
  });

  it("an unknown scope falls through to self", () => {
    expect(
      routeStatusScope("mystery" as StatusScope, {
        selectedAlly: ally,
        selectedHostile: hostile,
        aoeAllies: aoe,
      }),
    ).toEqual({ kind: "self" });
  });

  it("an undefined scope falls through to self", () => {
    expect(
      routeStatusScope(undefined, {
        selectedAlly: ally,
        selectedHostile: hostile,
        aoeAllies: aoe,
      }),
    ).toEqual({ kind: "self" });
  });
});
