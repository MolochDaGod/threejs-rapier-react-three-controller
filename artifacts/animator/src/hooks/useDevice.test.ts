import { describe, it, expect } from "vitest";
import { classifyDevice, type DeviceCaps } from "./useDevice";

/** Sensible desktop defaults; each test overrides only what matters. */
function caps(over: Partial<DeviceCaps> = {}): DeviceCaps {
  return {
    width: 1440,
    height: 900,
    coarse: false,
    noHover: false,
    anyFine: true,
    finePrimary: true,
    maxTouch: 0,
    touchEvents: false,
    ua: "Mozilla/5.0 (Windows NT 10.0)",
    platform: "Win32",
    ...over,
  };
}

describe("classifyDevice", () => {
  it("classifies a plain desktop with a mouse", () => {
    const d = classifyDevice(caps());
    expect(d.deviceClass).toBe("desktop");
    expect(d.primaryInput).toBe("mouse");
    expect(d.touchUI).toBe(false);
    expect(d.isTouch).toBe(false);
  });

  it("treats a narrow desktop window as desktop, not phone", () => {
    // Regression: width-only detection wrongly forced small windows into touch UI.
    const d = classifyDevice(caps({ width: 500, height: 700 }));
    expect(d.deviceClass).toBe("desktop");
    expect(d.touchUI).toBe(false);
  });

  it("classifies an iPhone as a touch phone", () => {
    const d = classifyDevice(
      caps({
        width: 390,
        height: 844,
        coarse: true,
        noHover: true,
        anyFine: false,
        finePrimary: false,
        maxTouch: 5,
        touchEvents: true,
        ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        platform: "iPhone",
      }),
    );
    expect(d.deviceClass).toBe("phone");
    expect(d.primaryInput).toBe("touch");
    expect(d.touchUI).toBe(true);
    expect(d.isIOS).toBe(true);
  });

  it("classifies an iPad (iPadOS reporting as MacIntel) as a touch tablet", () => {
    const d = classifyDevice(
      caps({
        width: 820,
        height: 1180,
        coarse: true,
        noHover: true,
        anyFine: false,
        finePrimary: false,
        maxTouch: 5,
        touchEvents: true,
        ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        platform: "MacIntel",
      }),
    );
    expect(d.deviceClass).toBe("tablet");
    expect(d.touchUI).toBe(true);
    expect(d.isIOS).toBe(true);
  });

  it("treats a touch-screen laptop (mouse primary) as desktop", () => {
    const d = classifyDevice(
      caps({
        width: 1536,
        height: 864,
        coarse: false,
        noHover: false,
        anyFine: true,
        finePrimary: true,
        maxTouch: 10,
        touchEvents: true,
      }),
    );
    expect(d.deviceClass).toBe("desktop");
    expect(d.primaryInput).toBe("mouse");
    expect(d.touchUI).toBe(false);
    expect(d.isTouch).toBe(true);
    expect(d.hasFinePointer).toBe(true);
  });

  it("uses the shortest edge for the phone↔tablet split (landscape phone stays phone)", () => {
    const d = classifyDevice(
      caps({
        width: 900,
        height: 400,
        coarse: true,
        noHover: true,
        anyFine: false,
        finePrimary: false,
        maxTouch: 5,
        touchEvents: true,
      }),
    );
    expect(d.deviceClass).toBe("phone");
  });
});
