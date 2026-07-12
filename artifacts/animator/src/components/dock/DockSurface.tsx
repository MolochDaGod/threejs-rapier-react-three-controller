import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Minus, ExternalLink, GripVertical } from "lucide-react";
import type {
  DockControls,
  DockDropTarget,
  DockFloatState,
  DockLayout,
  DockPanelDef,
  DockZoneId,
} from "./types";

interface Props {
  layout: DockLayout;
  controls: DockControls;
  panels: DockPanelDef[];
  /** Top offset (menubar height) so docked zones clear the menu. */
  menuHeight?: number;
}

/** Resolve which drop target sits under a screen point during a tab drag. */
function resolveDropTarget(x: number, y: number): DockDropTarget {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const hit = el?.closest("[data-dock-target]") as HTMLElement | null;
  const t = hit?.dataset.dockTarget;
  if (t?.startsWith("zone:")) {
    const rest = t.slice(5);
    if (rest.endsWith(":secondary")) {
      return { kind: "zone", zone: rest.slice(0, -":secondary".length) as DockZoneId, slot: "secondary" };
    }
    return { kind: "zone", zone: rest as DockZoneId, slot: "primary" };
  }
  if (t?.startsWith("float:")) return { kind: "float", floatId: t.slice(6) };
  return { kind: "new-float", x: x - 40, y: y - 14 };
}

/** Stable drag-hint key for a resolved target, used to highlight drop areas. */
function hintFor(t: DockDropTarget): string | null {
  if (t.kind === "zone") return t.slot === "secondary" ? `zone:${t.zone}:secondary` : `zone:${t.zone}`;
  if (t.kind === "float") return `float:${t.floatId}`;
  return null;
}

export function DockSurface({ layout, controls, panels, menuHeight = 52 }: Props) {
  const byId = (id: string) => panels.find((p) => p.id === id);

  // ── tab-share drag ─────────────────────────────────────────────────────────
  const dragRef = useRef<{ id: string; sx: number; sy: number; active: boolean } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; hint: string | null } | null>(null);

  const onTabMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
        d.active = true;
      }
      const tgt = resolveDropTarget(e.clientX, e.clientY);
      setDrag({ id: d.id, x: e.clientX, y: e.clientY, hint: hintFor(tgt) });
    },
    [],
  );

  const onTabUp = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("pointermove", onTabMove);
      window.removeEventListener("pointerup", onTabUp);
      if (d?.active) controls.movePanel(d.id, resolveDropTarget(e.clientX, e.clientY));
      else if (d) controls.setActive(d.id);
      setDrag(null);
    },
    [controls, onTabMove],
  );

  const startTabDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, active: false };
    window.addEventListener("pointermove", onTabMove);
    window.addEventListener("pointerup", onTabUp);
  };

  // ── zone resize ────────────────────────────────────────────────────────────
  const startZoneResize = (e: React.PointerEvent, zone: DockZoneId) => {
    e.preventDefault();
    e.stopPropagation();
    const startSize = layout.zones[zone].size;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const s =
        zone === "left"
          ? startSize + (ev.clientX - sx)
          : zone === "right"
            ? startSize - (ev.clientX - sx)
            : startSize - (ev.clientY - sy);
      controls.setZoneSize(zone, s);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── split divider (two stacked panels in one side zone) ────────────────────
  const startSplitResize = (e: React.PointerEvent, zone: DockZoneId) => {
    e.preventDefault();
    e.stopPropagation();
    const section = (e.currentTarget as HTMLElement).parentElement;
    const move = (ev: PointerEvent) => {
      if (!section) return;
      const rect = section.getBoundingClientRect();
      if (rect.height <= 0) return;
      controls.setZoneSplit(zone, (ev.clientY - rect.top) / rect.height);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── floating window move / resize ──────────────────────────────────────────
  const startFloatMove = (e: React.PointerEvent, f: DockFloatState) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-dock-notdrag]")) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = f.x;
    const oy = f.y;
    const move = (ev: PointerEvent) =>
      controls.setFloatRect(f.id, { x: Math.max(0, ox + (ev.clientX - sx)), y: Math.max(menuHeight, oy + (ev.clientY - sy)) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startFloatResize = (e: React.PointerEvent, f: DockFloatState) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const ow = f.w;
    const oh = f.h;
    const move = (ev: PointerEvent) =>
      controls.setFloatRect(f.id, { w: Math.max(220, ow + (ev.clientX - sx)), h: Math.max(160, oh + (ev.clientY - sy)) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── tab strip ──────────────────────────────────────────────────────────────
  const TabStrip = ({
    ids,
    active,
    extra,
  }: {
    ids: string[];
    active: string | null;
    extra?: React.ReactNode;
  }) => (
    <div className="dock-tabs" data-dock-notdrag>
      <div className="dock-tabs-list">
        {ids.map((id) => {
          const def = byId(id);
          if (!def) return null;
          return (
            <div
              key={id}
              className={`dock-tab ${id === active ? "on" : ""} ${drag?.id === id ? "dragging" : ""}`}
              onPointerDown={(e) => startTabDrag(e, id)}
              title={def.title}
            >
              {def.icon && <span className="dock-tab-icon">{def.icon}</span>}
              <span className="dock-tab-label">{def.title}</span>
              <button
                className="dock-tab-x"
                title="Hide panel"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  controls.hidePanel(id);
                }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="dock-tabs-tools">{extra}</div>
    </div>
  );

  // ── docked zones ───────────────────────────────────────────────────────────
  const leftReserve = layout.zones.left.panels.length ? layout.zones.left.size + 16 : 8;
  const rightReserve = layout.zones.right.panels.length ? layout.zones.right.size + 16 : 8;

  const renderZone = (zone: DockZoneId) => {
    const z = layout.zones[zone];
    if (!z.panels.length) return null;
    const collapsed = z.collapsed;
    const canSplit = zone === "left" || zone === "right";
    const hasSecondary = canSplit && z.secondary.length > 0;
    const split = Math.min(0.85, Math.max(0.15, z.split));
    const style: React.CSSProperties =
      zone === "left"
        ? { left: 8, top: menuHeight + 8, width: z.size, bottom: collapsed ? "auto" : 8 }
        : zone === "right"
          ? { right: 8, top: menuHeight + 8, width: z.size, bottom: collapsed ? "auto" : 8 }
          : { left: leftReserve, right: rightReserve, bottom: 8, height: collapsed ? "auto" : z.size };

    const primActive = z.active && z.panels.includes(z.active) ? z.active : z.panels[0];
    const primDef = primActive ? byId(primActive) : null;
    const secActive = z.secondaryActive && z.secondary.includes(z.secondaryActive) ? z.secondaryActive : z.secondary[0];
    const secDef = secActive ? byId(secActive) : null;

    return (
      <motion.section
        key={zone}
        layout
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className={`dock-zone dock-zone-${zone} ${collapsed ? "collapsed" : ""} ${drag?.hint === `zone:${zone}` ? "drop" : ""}`}
        style={style}
        data-dock-target={`zone:${zone}`}
      >
        {/* primary (top) group */}
        <div
          className={`dock-subzone ${drag?.hint === `zone:${zone}` ? "drop" : ""}`}
          style={hasSecondary && !collapsed ? { flex: `0 0 ${split * 100}%` } : { flex: 1 }}
          data-dock-target={`zone:${zone}`}
        >
          <TabStrip
            ids={z.panels}
            active={primActive}
            extra={
              <button
                className="dock-tool-btn"
                title={collapsed ? "Expand" : "Collapse"}
                onClick={() => controls.toggleCollapse(zone)}
              >
                <Minus size={12} />
              </button>
            }
          />
          {!collapsed && <div className="dock-body">{primDef?.render()}</div>}
        </div>

        {/* secondary (bottom) group + draggable divider */}
        {hasSecondary && !collapsed && (
          <>
            <div className="dock-split-divider" onPointerDown={(e) => startSplitResize(e, zone)} title="Drag to resize" />
            <div
              className={`dock-subzone ${drag?.hint === `zone:${zone}:secondary` ? "drop" : ""}`}
              style={{ flex: 1 }}
              data-dock-target={`zone:${zone}:secondary`}
            >
              <TabStrip ids={z.secondary} active={secActive ?? null} />
              <div className="dock-body">{secDef?.render()}</div>
            </div>
          </>
        )}

        {/* stack-below drop hint (only while dragging an unsplit side zone) */}
        {canSplit && !hasSecondary && !collapsed && drag && (
          <div
            className={`dock-split-hint ${drag?.hint === `zone:${zone}:secondary` ? "drop" : ""}`}
            data-dock-target={`zone:${zone}:secondary`}
          >
            Stack panel below
          </div>
        )}

        {!collapsed && (
          <div className={`dock-resize dock-resize-${zone}`} onPointerDown={(e) => startZoneResize(e, zone)} />
        )}
      </motion.section>
    );
  };

  return (
    <>
      <AnimatePresence>{(["left", "right", "bottom"] as DockZoneId[]).map(renderZone)}</AnimatePresence>

      {/* floating windows */}
      <AnimatePresence>
        {layout.floating.map((f) => {
          const active = f.active && f.panels.includes(f.active) ? f.active : f.panels[0];
          const def = active ? byId(active) : null;
          return (
            <motion.section
              key={f.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 460, damping: 36 }}
              className={`dock-float ${drag?.hint === `float:${f.id}` ? "drop" : ""}`}
              style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
              data-dock-target={`float:${f.id}`}
            >
              <div className="dock-float-head" onPointerDown={(e) => startFloatMove(e, f)}>
                <GripVertical size={13} className="dock-float-grip" />
                <TabStrip ids={f.panels} active={active} />
              </div>
              <div className="dock-body">{def?.render()}</div>
              <div className="dock-float-resize" onPointerDown={(e) => startFloatResize(e, f)} />
            </motion.section>
          );
        })}
      </AnimatePresence>

      {/* drag ghost */}
      {drag && (
        <div className="dock-drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          <ExternalLink size={12} />
          {byId(drag.id)?.title}
        </div>
      )}
    </>
  );
}
