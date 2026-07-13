/**
 * Shell UI edit mode — drag the movable chrome (mode title, wallet, toolbox)
 * to new places and persist the offsets. While editing, pointer input on a
 * movable element drags it instead of activating it (clicks are swallowed).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  clampLayout,
  clampOffset,
  defaultUiLayout,
  loadUiLayout,
  saveUiLayout,
  UI_ELEMENT_IDS,
  type UiElementId,
  type UiLayout,
} from "./uiLayout";

export interface UiEditBind {
  style: CSSProperties;
  className: string;
  onPointerDownCapture?: (e: React.PointerEvent) => void;
  onClickCapture?: (e: React.MouseEvent) => void;
}

export interface UiEditApi {
  editing: boolean;
  setEditing: (on: boolean) => void;
  /** Attach to a movable element (or a display:contents wrapper around one). */
  bind: (id: UiElementId) => UiEditBind;
  reset: () => void;
}

interface DragState {
  id: UiElementId;
  startX: number;
  startY: number;
  baseDx: number;
  baseDy: number;
  moved: boolean;
}

export function useUiEdit(): UiEditApi {
  const [layout, setLayout] = useState<UiLayout>(() =>
    typeof window === "undefined"
      ? defaultUiLayout()
      : loadUiLayout(window.innerWidth, window.innerHeight),
  );
  const [editing, setEditing] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Viewport shrink / orientation change: re-clamp so a previously valid
  // offset can never strand an element fully off-screen.
  useEffect(() => {
    const onResize = () => {
      const next = clampLayout(layoutRef.current, window.innerWidth, window.innerHeight);
      const changed = UI_ELEMENT_IDS.some(
        (id) =>
          next[id].dx !== layoutRef.current[id].dx || next[id].dy !== layoutRef.current[id].dy,
      );
      if (!changed) return;
      setLayout(next);
      saveUiLayout(next);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Window-level move/up so the drag keeps tracking outside the element
  // (no pointer capture — wrappers may be display:contents, which can't capture).
  useEffect(() => {
    if (!editing) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      const next = clampOffset(
        { dx: d.baseDx + dx, dy: d.baseDy + dy },
        window.innerWidth,
        window.innerHeight,
      );
      setLayout((prev) => ({ ...prev, [d.id]: next }));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      saveUiLayout(layoutRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dragRef.current = null;
    };
  }, [editing]);

  const bind = useCallback(
    (id: UiElementId): UiEditBind => {
      const off = layout[id];
      const style = {
        "--ui-dx": `${off.dx}px`,
        "--ui-dy": `${off.dy}px`,
      } as CSSProperties;
      if (!editing) return { style, className: "" };
      return {
        style,
        className: "ui-editable",
        onPointerDownCapture: (e) => {
          e.preventDefault();
          e.stopPropagation();
          dragRef.current = {
            id,
            startX: e.clientX,
            startY: e.clientY,
            baseDx: layoutRef.current[id].dx,
            baseDy: layoutRef.current[id].dy,
            moved: false,
          };
        },
        onClickCapture: (e) => {
          // Never activate buttons while editing (drag or plain click alike).
          e.preventDefault();
          e.stopPropagation();
        },
      };
    },
    [editing, layout],
  );

  const reset = useCallback(() => {
    const d = defaultUiLayout();
    setLayout(d);
    saveUiLayout(d);
  }, []);

  return { editing, setEditing, bind, reset };
}
