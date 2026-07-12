import { describe, expect, it } from "vitest";
import {
  clampLayout,
  clampOffset,
  defaultUiLayout,
  isDefaultLayout,
  mergeUiLayout,
  UI_ELEMENT_IDS,
} from "./uiLayout";

describe("uiLayout", () => {
  it("default layout is all-zero and reported as default", () => {
    const d = defaultUiLayout();
    for (const id of UI_ELEMENT_IDS) expect(d[id]).toEqual({ dx: 0, dy: 0 });
    expect(isDefaultLayout(d)).toBe(true);
  });

  it("clampOffset keeps offsets within the viewport-derived bounds", () => {
    expect(clampOffset({ dx: 5000, dy: -5000 }, 1280, 720)).toEqual({ dx: 1220, dy: -660 });
    expect(clampOffset({ dx: 10, dy: 20 }, 1280, 720)).toEqual({ dx: 10, dy: 20 });
  });

  it("clampOffset survives hostile numbers (NaN/Infinity) and rounds", () => {
    expect(clampOffset({ dx: NaN, dy: Infinity }, 1280, 720)).toEqual({ dx: 0, dy: 660 });
    expect(clampOffset({ dx: 10.6, dy: -3.4 }, 1280, 720)).toEqual({ dx: 11, dy: -3 });
  });

  it("clampOffset never goes negative-bound on tiny viewports", () => {
    expect(clampOffset({ dx: 999, dy: -999 }, 40, 40)).toEqual({ dx: 0, dy: 0 });
  });

  it("mergeUiLayout accepts valid persisted data", () => {
    const merged = mergeUiLayout({ topbar: { dx: 40, dy: 12 } }, 1280, 720);
    expect(merged.topbar).toEqual({ dx: 40, dy: 12 });
    expect(merged.wallet).toEqual({ dx: 0, dy: 0 });
    expect(isDefaultLayout(merged)).toBe(false);
  });

  it("clampLayout re-clamps a valid-at-save layout after the viewport shrinks", () => {
    const big = mergeUiLayout({ topbar: { dx: 900, dy: 500 }, wallet: { dx: -900, dy: 0 } }, 1920, 1080);
    expect(big.topbar).toEqual({ dx: 900, dy: 500 });
    const shrunk = clampLayout(big, 800, 400);
    expect(shrunk.topbar).toEqual({ dx: 740, dy: 340 });
    expect(shrunk.wallet).toEqual({ dx: -740, dy: 0 });
    expect(shrunk.assistant).toEqual({ dx: 0, dy: 0 });
  });

  it("mergeUiLayout rejects hostile shapes without throwing", () => {
    expect(mergeUiLayout(null, 1280, 720)).toEqual(defaultUiLayout());
    expect(mergeUiLayout("junk", 1280, 720)).toEqual(defaultUiLayout());
    expect(mergeUiLayout({ topbar: "junk", wallet: { dx: "a", dy: [] } }, 1280, 720)).toEqual(
      defaultUiLayout(),
    );
    expect(mergeUiLayout({ unknownElement: { dx: 9, dy: 9 } }, 1280, 720)).toEqual(
      defaultUiLayout(),
    );
  });
});
