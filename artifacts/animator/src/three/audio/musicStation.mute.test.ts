import { describe, expect, it } from "vitest";
import { combinedMuteGain } from "./musicStation";

describe("combinedMuteGain — global vs station mute independence", () => {
  it("is audible only when BOTH mutes are off", () => {
    expect(combinedMuteGain(false, false)).toBe(1);
    expect(combinedMuteGain(true, false)).toBe(0);
    expect(combinedMuteGain(false, true)).toBe(0);
    expect(combinedMuteGain(true, true)).toBe(0);
  });

  it("station mute survives a global mute toggle round-trip", () => {
    // User mutes the station, then toggles the global mixer mute on and off:
    // the station must STAY silent afterwards.
    const stationMuted = true;
    expect(combinedMuteGain(true, stationMuted)).toBe(0);
    expect(combinedMuteGain(false, stationMuted)).toBe(0);
  });

  it("global mute survives a station mute toggle round-trip", () => {
    const globalMuted = true;
    expect(combinedMuteGain(globalMuted, true)).toBe(0);
    expect(combinedMuteGain(globalMuted, false)).toBe(0);
  });
});
