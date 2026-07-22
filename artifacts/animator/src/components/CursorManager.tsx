/**
 * CursorManager — global context-aware cursor system.
 *
 * Three cursor contexts:
 *
 *  "combat"   — pointer lock active (3D aim): system cursor hidden, our
 *               Crosshair component owns the reticle. Body gets
 *               `cursor: none` so the OS arrow never bleeds through.
 *
 *  "interact" — mouse over a clickable element (button, door, crafting
 *               slot, NPC, portal). Cyan pixel-art pointer hand.
 *
 *  "default"  — everything else; mouse over non-interactable 3D scene,
 *               empty HUD areas. White pixel-art arrow cursor.
 *
 * The component mounts a single invisible <div> over the whole viewport
 * that delegates interaction to elements below (pointer-events: none).
 * Cursor switching is driven by two mechanisms:
 *
 *  1. CSS attribute selectors on [data-cursor] — any element in the tree
 *     can declare its cursor type: <button data-cursor="interact"> etc.
 *     This is the primary path for static UI.
 *
 *  2. `useCursorContext` hook — lets Three.js scenes push a cursor
 *     context programmatically (e.g. when a ray-cast hits a door mesh).
 */
import { useEffect, type ReactNode } from "react";
import "./grudgeCursors.css";

// ── cursor context store (module-level, no React overhead) ────────────────────

/** Extended contexts map to Toon RTS pack (public/cursors/01–20.png) */
export type CursorCtx =
  | "default"
  | "interact"
  | "combat"
  | "harvest"
  | "attack"
  | "build"
  | "magic"
  | "ally"
  | "enemy"
  | "talk"
  | "door"
  | "shop"
  | "wait"
  | "forbidden";

let _ctx: CursorCtx = "default";
const _listeners = new Set<() => void>();

/** Push a new cursor context (called by 3D scene ray-casts). */
export function setCursorCtx(ctx: CursorCtx): void {
  if (_ctx === ctx) return;
  _ctx = ctx;
  for (const fn of _listeners) fn();
}

/** Read the current context. */
export function getCursorCtx(): CursorCtx {
  return _ctx;
}

// ── cursor class resolver ─────────────────────────────────────────────────────

function bodyClass(ctx: CursorCtx): string {
  switch (ctx) {
    case "combat":     return "cursor-combat";
    case "interact":   return "cursor-interact";
    case "harvest":    return "cursor-harvest";
    case "attack":     return "cursor-attack";
    case "build":      return "cursor-build";
    case "magic":      return "cursor-magic";
    case "ally":       return "cursor-ally";
    case "enemy":      return "cursor-enemy";
    case "talk":       return "cursor-talk";
    case "door":       return "cursor-door";
    case "shop":       return "cursor-shop";
    case "wait":       return "cursor-wait";
    case "forbidden":  return "cursor-forbidden";
    default:           return "cursor-default";
  }
}

// ── provider ──────────────────────────────────────────────────────────────────

interface Props {
  children?: ReactNode;
}

/**
 * Mount once near the root. Keeps `document.body`’s cursor class in sync
 * with the active context. Fully self-contained:
 *   • Detects pointer-lock changes via DOM event (combat mode).
 *   • Routes hover over [data-cursor] elements to the store.
 *   • Falls back to "default" when leaving interactable elements.
 */
export function CursorManager({ children }: Props) {
  // Keep body class in sync with context store
  useEffect(() => {
    const apply = () => {
      const b = document.body;
      const all = [
        "cursor-default", "cursor-interact", "cursor-combat", "cursor-harvest",
        "cursor-attack", "cursor-build", "cursor-magic", "cursor-ally", "cursor-enemy",
        "cursor-talk", "cursor-door", "cursor-shop", "cursor-wait", "cursor-forbidden",
      ];
      b.classList.remove(...all);
      b.classList.add(bodyClass(_ctx));
    };
    apply();
    _listeners.add(apply);
    return () => { _listeners.delete(apply); };
  }, []);

  // Auto-detect pointer lock → combat / release → default
  useEffect(() => {
    const onChange = () => {
      if (document.pointerLockElement) {
        setCursorCtx("combat");
      } else if (_ctx === "combat") {
        setCursorCtx("default");
      }
    };
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  // Delegate mouseover on [data-cursor] elements to the store
  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      // Walk up to the nearest element with an explicit cursor declaration
      const el = (e.target as Element | null)?.closest("[data-cursor]");
      if (el) {
        const want = (el.getAttribute("data-cursor") as CursorCtx | null) ?? "default";
        setCursorCtx(want);
      } else {
        // Hovering bare canvas/scene/background → reset to default
        if (_ctx === "interact") setCursorCtx("default");
      }
    };
    document.addEventListener("mouseover", onOver, { passive: true });
    return () => document.removeEventListener("mouseover", onOver);
  }, []);

  return <>{children}</>;
}
