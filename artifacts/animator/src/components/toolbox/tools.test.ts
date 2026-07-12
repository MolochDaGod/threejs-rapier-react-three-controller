import { describe, expect, it } from "vitest";
import { UI_ICONS } from "../../three/icons";
import {
  TOOLBOX_TOOLS,
  onDressingPanelRequest,
  requestDressingPanel,
  type DangerPanelId,
  type DressingPanelId,
} from "./tools";

const DANGER_IDS: DangerPanelId[] = ["admin", "editor", "anim", "animdbg"];
const DRESSING_IDS: DressingPanelId[] = [
  "hierarchy",
  "wardrobe",
  "anim",
  "arsenal",
  "vfx",
  "playground",
];

describe("TOOLBOX_TOOLS", () => {
  it("covers all 25 sheet icons exactly once, in sheet order", () => {
    expect(TOOLBOX_TOOLS).toHaveLength(25);
    expect(TOOLBOX_TOOLS.map((t) => t.icon)).toEqual([...UI_ICONS]);
  });

  it("every tool has a label, hint, and a valid action target", () => {
    for (const tool of TOOLBOX_TOOLS) {
      expect(tool.label.length).toBeGreaterThan(0);
      expect(tool.hint.length).toBeGreaterThan(0);
      const a = tool.action;
      if (a.kind === "danger-panel") expect(DANGER_IDS).toContain(a.id);
      if (a.kind === "dressing-panel") expect(DRESSING_IDS).toContain(a.id);
    }
  });
});

describe("dressing panel request bus", () => {
  it("buffers a request made before any subscriber and delivers it on subscribe", () => {
    requestDressingPanel("vfx");
    const got: string[] = [];
    const off = onDressingPanelRequest((id) => got.push(id));
    expect(got).toEqual(["vfx"]);
    off();
  });

  it("delivers live requests immediately while subscribed, and stops after unsubscribe", () => {
    const got: string[] = [];
    const off = onDressingPanelRequest((id) => got.push(id));
    requestDressingPanel("wardrobe");
    expect(got).toEqual(["wardrobe"]);
    off();
    // No subscriber again: buffered for the next mount, not delivered to `got`.
    requestDressingPanel("anim");
    expect(got).toEqual(["wardrobe"]);
    const got2: string[] = [];
    const off2 = onDressingPanelRequest((id) => got2.push(id));
    expect(got2).toEqual(["anim"]);
    off2();
  });

  it("does not re-deliver a consumed buffered request", () => {
    const first: string[] = [];
    const off = onDressingPanelRequest((id) => first.push(id));
    off();
    const second: string[] = [];
    const off2 = onDressingPanelRequest((id) => second.push(id));
    expect(second).toEqual([]);
    off2();
  });
});
