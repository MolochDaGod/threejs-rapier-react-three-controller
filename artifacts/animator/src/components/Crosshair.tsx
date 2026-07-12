/**
 * Crosshair — dual-layer reticle system.
 *
 * Architecture:
 *   • CENTER DOT  — always `position: fixed; top: 50%; left: 50%`.
 *                   Never moves. Shows OWR range ring + hit-marker.
 *                   Visible in every non-combat cursor mode.
 *
 *   • TICKS LAYER — same element; tick lines radiate from center.
 *                   Bloom spread driven by movement/recoil.
 *
 *   • HARVEST RING — a larger circle replacing ticks in harvest
 *                    mode to indicate area-of-effect placement.
 *
 *   • COMBAT (pointer-lock) — standard centered tightest reticle,
 *                              OS cursor hidden by cursor-combat CSS.
 */

import type { CSSProperties } from "react";

/** Mode-contextual reticle style. */
export type CrosshairMode =
  | "combat"    // pointer-locked, tight aim — ticks active, cursor hidden
  | "harvest"   // tool mode, area ring + no ticks
  | "ui";       // browsing UI / menus — dot only, no ticks

interface Props {
  visible: boolean;
  /**
   * Extra gap (px) added between the centre dot and each tick, on top of the
   * base gap. Driven by movement + recoil bloom. 0 = tightest.
   */
  spread?: number;
  /** First-person reticle variant (tighter, brighter mint). */
  firstPerson?: boolean;
  /** Rising on a confirmed hit; pulses the hit-marker. */
  hitMarker?: number;
  /**
   * OWR distance ring: green = optimal, yellow = far, red = close, none = off.
   */
  rangeState?: "close" | "optimal" | "far" | "none";
  /**
   * Contextual mode. Controls which layers are visible:
   *   combat  — full ticks + dot (default for pointer-locked play)
   *   harvest — dot + harvest ring only (no ticks)
   *   ui      — dot only (browsing menus, no reticle chrome)
   */
  mode?: CrosshairMode;
  /** Optional HUD-editor binding. */
  editBind?: {
    "data-hud-panel": string;
    className: string;
    style: CSSProperties;
    onPointerDown?: (e: React.PointerEvent) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
  };
}

export function Crosshair({
  visible,
  spread = 0,
  firstPerson = false,
  hitMarker = 0,
  rangeState = "none",
  mode = "combat",
  editBind,
}: Props) {
  const editing = !!editBind && editBind.className.includes("hud-editable");
  if (!visible && !editing) return null;

  const gap = Math.max(0, Math.min(28, spread));
  const showTicks   = mode === "combat" || editing;
  const showHarvest = mode === "harvest";

  const style = {
    ["--ch-gap" as string]: `${gap}px`,
    ...editBind?.style,
  } as CSSProperties;

  return (
    <div
      data-hud-panel={editBind?.["data-hud-panel"]}
      className={[
        "crosshair",
        firstPerson ? "crosshair-fp" : "",
        `crosshair-${mode}`,
        editBind?.className ?? "",
      ].join(" ").trim()}
      style={style}
      onPointerDown={editBind?.onPointerDown}
      onContextMenu={editBind?.onContextMenu}
      aria-hidden
    >
      {/* OWR range ring — always around center dot when a target is focused */}
      {rangeState !== "none" && <span className={`ch-range ch-range-${rangeState}`} />}

      {/* Harvest area ring (replaces ticks in harvest mode) */}
      {showHarvest && <span className="ch-harvest-ring" />}

      {/* Center dot — always visible when crosshair is shown */}
      <span className="ch-dot" />

      {/* Tick lines — combat + editing only */}
      {showTicks && (
        <>
          <span className="ch-line ch-top" />
          <span className="ch-line ch-bottom" />
          <span className="ch-line ch-left" />
          <span className="ch-line ch-right" />
        </>
      )}

      {/* Hit marker — diagonal pop on confirmed hit */}
      {hitMarker > 0 && (
        <span key={hitMarker} className="ch-hit">
          <span className="ch-hit-line ch-hit-tl" />
          <span className="ch-hit-line ch-hit-tr" />
          <span className="ch-hit-line ch-hit-bl" />
          <span className="ch-hit-line ch-hit-br" />
        </span>
      )}
    </div>
  );
}
