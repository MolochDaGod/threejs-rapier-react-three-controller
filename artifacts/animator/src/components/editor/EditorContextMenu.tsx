import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorScene } from "../../three/editor/EditorScene";
import type { ColliderShape, EditorSnapshot, PrimitiveKind } from "../../three/editor/types";

interface Props {
  engine: EditorScene;
  snap: EditorSnapshot;
}

const COLLIDER_SHAPES: ColliderShape[] = ["box", "sphere", "capsule", "cylinder"];
const PRIMS: PrimitiveKind[] = ["box", "sphere", "cylinder", "cone", "plane", "torus"];

/**
 * The right-click context menu. The engine raycasts under the cursor on RMB-click
 * and hands React a `contextMenu` request (screen position + hit node) via the
 * snapshot; this overlay renders the actionable menu, clamped into the viewport,
 * and closes on outside-click / Esc / after any action.
 */
export function EditorContextMenu({ engine, snap }: Props) {
  const menu = snap.contextMenu;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu?.x ?? 0, y: menu?.y ?? 0 });

  // Clamp the menu inside the viewport once it has measured its own size.
  useLayoutEffect(() => {
    if (!menu) return;
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const x = Math.min(menu.x, window.innerWidth - width - pad);
    const y = Math.min(menu.y, window.innerHeight - height - pad);
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y) });
  }, [menu?.id]);

  // Close on outside pointerdown (capture so it beats the canvas handlers).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) engine.closeContextMenu();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [menu?.id, engine]);

  if (!menu) return null;

  const selCount = snap.selectedIds.length;
  const hasSel = selCount > 0;
  const run = (fn: () => void) => {
    fn();
    engine.closeContextMenu();
  };

  return (
    <div className="ed-ctx" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <div className="ed-ctx-head">{menu.targetName ?? "Scene"}</div>

      {hasSel && (
        <>
          <button className="ed-ctx-item" onClick={() => run(() => engine.focusSelected())}>
            Focus
            <span className="k">F</span>
          </button>
          <button className="ed-ctx-item" onClick={() => run(() => engine.duplicateSelected())}>
            Duplicate{selCount > 1 ? ` (${selCount})` : ""}
            <span className="k">Ctrl D</span>
          </button>
          <button className="ed-ctx-item danger" onClick={() => run(() => engine.deleteSelected())}>
            Delete{selCount > 1 ? ` (${selCount})` : ""}
            <span className="k">Del</span>
          </button>

          <div className="ed-ctx-sep" />
          <div className="ed-ctx-label">Add collider</div>
          <div className="ed-ctx-chips">
            {COLLIDER_SHAPES.map((s) => (
              <button key={s} className="ed-chip" onClick={() => run(() => engine.addColliderToSelection(s))}>
                {s}
              </button>
            ))}
          </div>

          <div className="ed-ctx-sep" />
          <div className="ed-ctx-label">Move to layer</div>
          <div className="ed-ctx-chips">
            {snap.layers.map((l) => (
              <button key={l.id} className="ed-chip" onClick={() => run(() => engine.setSelectionLayer(l.id))}>
                <span className="dot" style={{ background: `#${l.color.toString(16).padStart(6, "0")}` }} />
                {l.name}
              </button>
            ))}
          </div>

          <div className="ed-ctx-sep" />
        </>
      )}

      <div className="ed-ctx-label">Add primitive</div>
      <div className="ed-ctx-chips">
        {PRIMS.map((p) => (
          <button key={p} className="ed-chip" onClick={() => run(() => engine.addPrimitive(p))}>
            {p}
          </button>
        ))}
      </div>

      <div className="ed-ctx-sep" />
      <button className="ed-ctx-item" onClick={() => run(() => engine.selectAll())}>
        Select all
        <span className="k">Ctrl A</span>
      </button>
      {hasSel && (
        <button className="ed-ctx-item" onClick={() => run(() => engine.deselectAll())}>
          Deselect
        </button>
      )}
    </div>
  );
}
