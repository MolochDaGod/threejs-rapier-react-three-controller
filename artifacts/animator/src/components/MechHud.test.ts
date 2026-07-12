import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HudSnapshot } from "../three/types";
import { MechHud } from "./MechHud";

// MechHud only reads hud.mech, hud.health and hud.maxHealth, so a partial
// snapshot cast to HudSnapshot keeps these render tests focused.
function snapshot(partial: Partial<HudSnapshot>): HudSnapshot {
  return { health: 100, maxHealth: 100, mech: null, ...partial } as HudSnapshot;
}

const SLAM = { key: "Q", name: "Seismic Stomp", icon: "siege", cd: 0, cdMax: 8 };
const SECONDARY = { key: "E", name: "Rocket Barrage", icon: "charge", cd: 2, cdMax: 6 };

describe("MechHud", () => {
  it("renders nothing while on foot (mech is null)", () => {
    expect(renderToStaticMarkup(createElement(MechHud, { hud: snapshot({ mech: null }) }))).toBe("");
  });

  it("renders the cockpit with armour integrity and the slam gauge while piloting", () => {
    const html = renderToStaticMarkup(
      createElement(MechHud, {
        hud: snapshot({ health: 50, maxHealth: 100, mech: { abilities: [SLAM, SECONDARY] } }),
      }),
    );
    expect(html).toContain("mech-cockpit");
    expect(html).toContain("ARMOUR INTEGRITY");
    expect(html).toContain("50%");
    expect(html).toContain("Seismic Stomp");
    expect(html).toContain("Rocket Barrage");
    expect(html).toContain("mc-hero");
  });

  it("flags critical armour integrity at or below 30%", () => {
    const html = renderToStaticMarkup(
      createElement(MechHud, {
        hud: snapshot({ health: 30, maxHealth: 100, mech: { abilities: [SLAM] } }),
      }),
    );
    expect(html).toContain("mc-crit");
    expect(html).toContain("30%");
  });

  it("renders without a slam gauge when no abilities are supplied", () => {
    const html = renderToStaticMarkup(
      createElement(MechHud, { hud: snapshot({ mech: { abilities: [] } }) }),
    );
    expect(html).toContain("mech-cockpit");
    expect(html).not.toContain("mc-hero");
  });
});
