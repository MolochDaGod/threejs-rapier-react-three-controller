import { describe, it, expect } from "vitest";
import { parseMood, companionSystemPrompt, COMPANION_MOODS } from "./companionPrompt";

describe("parseMood", () => {
  it("extracts a leading mood tag and strips it from the spoken text", () => {
    expect(parseMood("[cool] Took you long enough.")).toEqual({
      mood: "cool",
      clean: "Took you long enough.",
    });
  });

  it("matches every supported mood, case-insensitively", () => {
    expect(parseMood("[SMILE] hi").mood).toBe("smile");
    expect(parseMood("[Angry] no").mood).toBe("angry");
    expect(parseMood("[surprise] oh").mood).toBe("surprise");
    expect(parseMood("[scan] hmm").mood).toBe("scan");
  });

  it("parses every mood in COMPANION_MOODS (no parser/vocabulary drift)", () => {
    for (const mood of COMPANION_MOODS) {
      expect(parseMood(`[${mood}] hi`).mood).toBe(mood);
    }
  });

  it("documents every companion mood in the system prompt", () => {
    const prompt = companionSystemPrompt();
    for (const mood of COMPANION_MOODS) {
      expect(prompt).toContain(`[${mood}]`);
    }
  });

  it("tolerates stray whitespace around the tag", () => {
    expect(parseMood("  [smile]   hello ")).toEqual({ mood: "smile", clean: "hello " });
  });

  it("returns no mood when the text has no leading tag", () => {
    expect(parseMood("just talking")).toEqual({ mood: null, clean: "just talking" });
  });

  it("ignores an unknown bracketed token", () => {
    expect(parseMood("[bored] meh")).toEqual({ mood: null, clean: "[bored] meh" });
  });

  it("only honors a tag at the very start, not mid-sentence", () => {
    expect(parseMood("well [smile] then").mood).toBeNull();
  });

  it("during streaming, leaves a partial leading tag untouched until complete", () => {
    expect(parseMood("[sm")).toEqual({ mood: null, clean: "[sm" });
    expect(parseMood("[smile")).toEqual({ mood: null, clean: "[smile" });
    expect(parseMood("[smile]")).toEqual({ mood: "smile", clean: "" });
  });
});
