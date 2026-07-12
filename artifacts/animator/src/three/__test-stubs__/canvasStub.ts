// Headless <canvas> + 2D-context stub for the node test environment.
//
// Several Danger Room visual-effect modules build `THREE.CanvasTexture`s at
// construction time by drawing onto a real canvas (telegraph rings, indicator
// dots, status footprints — see `fx/fxTextures.ts` and `fx/Indicators.ts`).
// They call `document.createElement("canvas")` + `getContext("2d")`, which throw
// "document is not defined" under vitest's default `node` environment.
//
// These suites assert engine *behavior* (telegraph timing, faction-gated AoE
// resolves, collider pose math, ragdoll geometry) and never inspect the rendered
// pixels, so a no-op canvas that merely satisfies the 2D drawing API is enough.
// A stub (vs. a full jsdom/happy-dom DOM environment) keeps the OOM-safe
// single-fork test run lean — see `.agents/memory/animator-vitest-oom.md`.
//
// Registered as a vitest `setupFiles` entry, so it runs once per test file
// before any module is imported.

type StubImageData = { data: Uint8ClampedArray; width: number; height: number };

class StubGradient {
  addColorStop(): void {}
}

/** A 2D context whose drawing calls are no-ops but whose factory methods return
 *  shape-correct objects (gradients, image data) the FX code reads back. */
class StubContext2D {
  fillStyle: string | StubGradient = "";
  strokeStyle: string | StubGradient = "";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  globalAlpha = 1;
  font = "";
  textAlign = "start";
  textBaseline = "alphabetic";

  createRadialGradient(): StubGradient {
    return new StubGradient();
  }
  createLinearGradient(): StubGradient {
    return new StubGradient();
  }
  createImageData(width: number, height: number): StubImageData {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }
  getImageData(_x: number, _y: number, width: number, height: number): StubImageData {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }
  putImageData(): void {}
  fillRect(): void {}
  clearRect(): void {}
  strokeRect(): void {}
  beginPath(): void {}
  closePath(): void {}
  arc(): void {}
  rect(): void {}
  ellipse(): void {}
  fill(): void {}
  stroke(): void {}
  clip(): void {}
  moveTo(): void {}
  lineTo(): void {}
  quadraticCurveTo(): void {}
  bezierCurveTo(): void {}
  fillText(): void {}
  strokeText(): void {}
  measureText(): { width: number } {
    return { width: 0 };
  }
  setLineDash(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  setTransform(): void {}
  resetTransform(): void {}
  drawImage(): void {}
}

/** A canvas element exposing only the surface the FX code touches. */
class StubCanvas {
  width = 0;
  height = 0;
  getContext(kind: string): StubContext2D | null {
    return kind === "2d" ? new StubContext2D() : null;
  }
  toDataURL(): string {
    return "";
  }
}

const g = globalThis as Record<string, unknown>;

if (typeof g.document === "undefined") {
  g.document = {
    createElement(tag: string): unknown {
      return tag === "canvas" ? new StubCanvas() : {};
    },
  };
}
