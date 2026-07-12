/**
 * Global tooltip layer. Any element with a `data-tip="…"` attribute gets a
 * styled tooltip: instant-ish on mouse hover, long-press (~450ms) on touch
 * (where native `title` never shows). Mounted once by the AppShell so every
 * mode gets it for free — no per-component wiring beyond the attribute.
 *
 * Positioning: fixed, centred above the anchor (flips below when there is no
 * headroom), clamped to the viewport. Hidden on click, scroll, pointer-out,
 * or window blur. The layer itself is pointer-events: none so it can never
 * steal input from gameplay UI.
 */
import { useEffect, useRef, useState } from "react";

interface TipState {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

const HOVER_DELAY_MS = 250;
const TOUCH_HOLD_MS = 450;
/** Keep the tooltip's centre this far from the viewport edges. */
const EDGE_PAD = 14;
/** Flip below the anchor when it sits closer than this to the top. */
const HEADROOM = 52;

export function TipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const timer = useRef<number | null>(null);
  const anchor = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const showFor = (el: HTMLElement) => {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      const r = el.getBoundingClientRect();
      const below = r.top < HEADROOM;
      setTip({
        text,
        x: Math.min(Math.max(r.left + r.width / 2, EDGE_PAD), window.innerWidth - EDGE_PAD),
        y: below ? r.bottom + 8 : r.top - 8,
        below,
      });
    };

    const hide = () => {
      clearTimer();
      anchor.current = null;
      setTip(null);
    };

    const tipTargetOf = (e: Event): HTMLElement | null => {
      const t = e.target;
      if (!(t instanceof Element)) return null;
      return t.closest<HTMLElement>("[data-tip]");
    };

    // Mouse / pen hover: arm a short delay, then show. Moving onto anything
    // without a data-tip hides the current tooltip.
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = tipTargetOf(e);
      if (!el) {
        if (anchor.current) hide();
        return;
      }
      if (el === anchor.current) return;
      clearTimer();
      anchor.current = el;
      setTip(null);
      timer.current = window.setTimeout(() => {
        if (anchor.current === el && el.isConnected) showFor(el);
      }, HOVER_DELAY_MS);
    };

    // Leaving the window entirely (relatedTarget null) hides the tooltip —
    // pointerover never fires in that case.
    const onOut = (e: PointerEvent) => {
      if (e.relatedTarget === null && anchor.current) hide();
    };

    // Touch: long-press shows the tooltip; release hides it (the press still
    // delivers its normal tap on release, so gameplay buttons are unaffected).
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") {
        hide();
        return;
      }
      const el = tipTargetOf(e);
      hide();
      if (!el) return;
      anchor.current = el;
      timer.current = window.setTimeout(() => {
        if (anchor.current === el && el.isConnected) showFor(el);
      }, TOUCH_HOLD_MS);
    };

    const onEnd = (e: PointerEvent) => {
      if (e.pointerType === "touch") hide();
    };

    // Keyboard access: focusing a [data-tip] control via Tab shows its tooltip.
    // Gated on :focus-visible so mouse/touch clicks (which also focus) don't
    // double-trigger — the pointer paths above already handle those.
    const onFocusIn = (e: FocusEvent) => {
      const el = tipTargetOf(e);
      if (!el) {
        if (anchor.current) hide();
        return;
      }
      if (el === anchor.current) return;
      if (!el.matches(":focus-visible")) return;
      clearTimer();
      anchor.current = el;
      showFor(el);
    };
    const onFocusOut = () => {
      if (anchor.current) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    const onHide = () => hide();

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onEnd, true);
    document.addEventListener("pointercancel", onEnd, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onHide, true);
    window.addEventListener("resize", onHide);
    window.addEventListener("blur", onHide);
    return () => {
      clearTimer();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onEnd, true);
      document.removeEventListener("pointercancel", onEnd, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onHide, true);
      window.removeEventListener("resize", onHide);
      window.removeEventListener("blur", onHide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      className={`app-tip${tip.below ? " below" : ""}`}
      style={{ left: tip.x, top: tip.y }}
      role="tooltip"
    >
      {tip.text}
    </div>
  );
}
