import { describe, expect, it } from "vitest";
import {
  applyEscape,
  applyToggleBuild,
  applyToggleHarvestWheel,
  modeAllowsBlock,
  modeAllowsCombatSkills,
  normalizeActivityState,
  resolveActivityKey,
  resolveActivityMouse,
  type ActivityInputState,
} from "./activityInput";

const base = (over: Partial<ActivityInputState> = {}): ActivityInputState => ({
  mode: "combat",
  toolWheelOpen: false,
  castActive: false,
  ...over,
});

describe("normalizeActivityState", () => {
  it("closes wheel in build", () => {
    expect(normalizeActivityState("build", true)).toEqual({
      mode: "build",
      toolWheelOpen: false,
    });
  });

  it("promotes wheel-only to harvest", () => {
    expect(normalizeActivityState("combat", true)).toEqual({
      mode: "harvest",
      toolWheelOpen: true,
    });
  });

  it("combat never keeps wheel", () => {
    expect(normalizeActivityState("combat", false).toolWheelOpen).toBe(false);
  });
});

describe("resolveActivityKey — combat", () => {
  it("maps fleet combat residuals", () => {
    const s = base({ mode: "combat" });
    expect(resolveActivityKey(s, "KeyX").type).toBe("combat_dodge");
    expect(resolveActivityKey(s, "KeyC").type).toBe("combat_parry");
    expect(resolveActivityKey(s, "KeyE").type).toBe("combat_block");
    expect(resolveActivityKey(s, "KeyF").type).toBe("combat_skill");
    expect(resolveActivityKey(s, "KeyR").type).toBe("combat_heavy_or_reload");
    expect(resolveActivityKey(s, "Digit1")).toEqual({ type: "combat_skill", slot: 0 });
  });

  it("mode switches always available", () => {
    const s = base({ mode: "combat" });
    expect(resolveActivityKey(s, "KeyB").type).toBe("toggle_build");
    expect(resolveActivityKey(s, "KeyU").type).toBe("toggle_harvest_wheel");
    expect(resolveActivityKey(s, "KeyK").type).toBe("view_toggle");
  });

  it("illegal combat+wheel normalizes to harvest tool keys", () => {
    // Desynced state: wheel open while labeled combat → treat as harvest.
    const s = base({ mode: "combat", toolWheelOpen: true });
    expect(resolveActivityKey(s, "Digit2")).toEqual({ type: "tool_slot", index: 1 });
    expect(resolveActivityKey(s, "KeyF").type).toBe("noop");
  });
});

describe("resolveActivityKey — build", () => {
  it("R rotates and Y cycles; combat residuals are noop", () => {
    const s = base({ mode: "build" });
    expect(resolveActivityKey(s, "KeyR").type).toBe("build_rotate");
    expect(resolveActivityKey(s, "KeyY").type).toBe("build_cycle");
    expect(resolveActivityKey(s, "KeyX").type).toBe("noop");
    expect(resolveActivityKey(s, "KeyC").type).toBe("noop");
    expect(resolveActivityKey(s, "KeyF").type).toBe("noop");
    expect(resolveActivityKey(s, "Digit1").type).toBe("noop");
    expect(resolveActivityKey(s, "KeyE").type).toBe("noop");
  });

  it("still allows jump and mode toggles", () => {
    const s = base({ mode: "build" });
    expect(resolveActivityKey(s, "Space").type).toBe("jump");
    expect(resolveActivityKey(s, "KeyB").type).toBe("toggle_build");
    expect(resolveActivityKey(s, "KeyU").type).toBe("toggle_harvest_wheel");
  });
});

describe("resolveActivityKey — harvest", () => {
  it("1–4 select tools with wheel open or closed", () => {
    expect(resolveActivityKey(base({ mode: "harvest", toolWheelOpen: true }), "Digit2")).toEqual({
      type: "tool_slot",
      index: 1,
    });
    expect(resolveActivityKey(base({ mode: "harvest", toolWheelOpen: false }), "Digit1")).toEqual({
      type: "tool_slot",
      index: 0,
    });
  });

  it("suppresses skill/heavy/parry; keeps dodge/block/butcher", () => {
    const s = base({ mode: "harvest" });
    expect(resolveActivityKey(s, "KeyF").type).toBe("noop");
    expect(resolveActivityKey(s, "KeyR").type).toBe("noop");
    expect(resolveActivityKey(s, "KeyC").type).toBe("noop");
    expect(resolveActivityKey(s, "KeyX").type).toBe("combat_dodge");
    expect(resolveActivityKey(s, "KeyE").type).toBe("combat_block");
    expect(resolveActivityKey(s, "KeyN").type).toBe("combat_butcher");
  });
});

describe("resolveActivityMouse", () => {
  it("build: LMB place, RMB remove, no attack", () => {
    const s = base({ mode: "build" });
    expect(resolveActivityMouse(s, 0).type).toBe("build_place");
    expect(resolveActivityMouse(s, 2).type).toBe("build_remove");
    expect(resolveActivityMouse(s, 1).type).toBe("noop");
  });

  it("harvest: LMB attack, no M3 motion, RMB lock", () => {
    const s = base({ mode: "harvest" });
    expect(resolveActivityMouse(s, 0).type).toBe("attack");
    expect(resolveActivityMouse(s, 1).type).toBe("noop");
    expect(resolveActivityMouse(s, 2).type).toBe("lock_toggle");
  });

  it("combat: LMB attack, M3 motion, RMB lock", () => {
    const s = base({ mode: "combat" });
    expect(resolveActivityMouse(s, 0).type).toBe("attack");
    expect(resolveActivityMouse(s, 1).type).toBe("motion_attack");
    expect(resolveActivityMouse(s, 2).type).toBe("lock_toggle");
  });

  it("cast overrides mode", () => {
    const s = base({ mode: "build", castActive: true });
    expect(resolveActivityMouse(s, 0).type).toBe("cast_confirm");
    expect(resolveActivityMouse(s, 2).type).toBe("cast_cancel");
  });
});

describe("mode transitions", () => {
  it("toggle build on/off from combat and harvest", () => {
    expect(applyToggleBuild("combat", false, false)).toEqual({
      mode: "build",
      toolWheelOpen: false,
      buildOn: true,
    });
    expect(applyToggleBuild("harvest", true, false)).toEqual({
      mode: "build",
      toolWheelOpen: false,
      buildOn: true,
    });
    expect(applyToggleBuild("build", false, true)).toEqual({
      mode: "combat",
      toolWheelOpen: false,
      buildOn: false,
    });
  });

  it("toggle harvest wheel enters harvest and exits build", () => {
    expect(applyToggleHarvestWheel("combat", false)).toEqual({
      mode: "harvest",
      toolWheelOpen: true,
      exitBuild: true,
    });
    expect(applyToggleHarvestWheel("build", false)).toEqual({
      mode: "harvest",
      toolWheelOpen: true,
      exitBuild: true,
    });
    expect(applyToggleHarvestWheel("harvest", true)).toEqual({
      mode: "harvest",
      toolWheelOpen: false,
      exitBuild: true,
    });
  });

  it("escape: cast first, then wheel, then build, then harvest", () => {
    // Cast wins even if wheel open
    expect(applyEscape("harvest", true, true)).toMatchObject({
      cancelCast: true,
      handled: true,
      toolWheelOpen: true,
      mode: "harvest",
    });
    expect(applyEscape("harvest", true, false)).toMatchObject({
      mode: "harvest",
      toolWheelOpen: false,
      handled: true,
    });
    expect(applyEscape("build", false, false)).toMatchObject({
      mode: "combat",
      exitBuild: true,
      handled: true,
    });
    expect(applyEscape("harvest", false, false)).toMatchObject({
      mode: "combat",
      handled: true,
    });
    expect(applyEscape("combat", false, false).handled).toBe(false);
  });
});

describe("mode capability helpers", () => {
  it("block allowed in combat/harvest only", () => {
    expect(modeAllowsBlock("combat")).toBe(true);
    expect(modeAllowsBlock("harvest")).toBe(true);
    expect(modeAllowsBlock("build")).toBe(false);
  });

  it("combat skills only in combat", () => {
    expect(modeAllowsCombatSkills("combat")).toBe(true);
    expect(modeAllowsCombatSkills("harvest")).toBe(false);
    expect(modeAllowsCombatSkills("build")).toBe(false);
  });
});

describe("full state machine walk", () => {
  it("combat → B build → U harvest → Esc combat", () => {
    let mode: ActivityInputState["mode"] = "combat";
    let wheel = false;

    let t = applyToggleBuild(mode, wheel, false);
    mode = t.mode;
    wheel = t.toolWheelOpen;
    expect(mode).toBe("build");
    expect(resolveActivityKey(base({ mode, toolWheelOpen: wheel }), "KeyF").type).toBe("noop");
    expect(resolveActivityMouse(base({ mode, toolWheelOpen: wheel }), 0).type).toBe("build_place");

    t = applyToggleHarvestWheel(mode, wheel);
    mode = t.mode;
    wheel = t.toolWheelOpen;
    expect(mode).toBe("harvest");
    expect(wheel).toBe(true);
    expect(resolveActivityKey(base({ mode, toolWheelOpen: wheel }), "Digit1").type).toBe(
      "tool_slot",
    );

    let e = applyEscape(mode, wheel, false);
    mode = e.mode;
    wheel = e.toolWheelOpen;
    expect(mode).toBe("harvest");
    expect(wheel).toBe(false);

    e = applyEscape(mode, wheel, false);
    mode = e.mode;
    wheel = e.toolWheelOpen;
    expect(mode).toBe("combat");
    expect(resolveActivityKey(base({ mode, toolWheelOpen: wheel }), "KeyF").type).toBe(
      "combat_skill",
    );
  });
});
