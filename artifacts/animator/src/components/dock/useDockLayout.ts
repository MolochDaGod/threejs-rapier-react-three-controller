import { useCallback, useMemo, useRef, useState } from "react";
import type {
  DockControls,
  DockDropTarget,
  DockFloatState,
  DockLayout,
  DockLocation,
  DockPanelMeta,
  DockZoneId,
  DockZoneState,
} from "./types";

const ZONE_IDS: DockZoneId[] = ["left", "right", "bottom"];
const DEFAULT_SIZE: Record<DockZoneId, number> = { left: 270, right: 300, bottom: 220 };

let floatSeq = 0;
const nextFloatId = () => `flt-${Date.now().toString(36)}-${floatSeq++}`;

function emptyZone(size: number): DockZoneState {
  return { panels: [], active: null, size, collapsed: false, secondary: [], secondaryActive: null, split: 0.5 };
}

function emptyLayout(): DockLayout {
  return {
    zones: {
      left: emptyZone(DEFAULT_SIZE.left),
      right: emptyZone(DEFAULT_SIZE.right),
      bottom: emptyZone(DEFAULT_SIZE.bottom),
    },
    floating: [],
    hidden: [],
  };
}

/** Backfill split fields on a (possibly older) persisted zone, filtering to valid ids. */
function normZone(z: Partial<DockZoneState> | undefined, fallbackSize: number, valid: Set<string>): DockZoneState {
  const base = emptyZone(fallbackSize);
  const panels = (z?.panels ?? []).filter((p) => valid.has(p));
  const secondary = (z?.secondary ?? []).filter((p) => valid.has(p));
  return {
    panels,
    active: z?.active ?? null,
    size: z?.size ?? fallbackSize,
    collapsed: z?.collapsed ?? false,
    secondary,
    secondaryActive: z?.secondaryActive ?? null,
    split: Math.min(0.85, Math.max(0.15, z?.split ?? base.split)),
  };
}

/** If a zone's primary group is empty but it has a secondary group, promote it. */
function promoteSecondary(z: DockZoneState): DockZoneState {
  if (z.panels.length || !z.secondary.length) return z;
  return { ...z, panels: z.secondary, active: z.secondaryActive ?? z.secondary[0], secondary: [], secondaryActive: null };
}

/** Fresh layout: every panel in its home zone (unless defaultVisible === false). */
function buildDefault(metas: DockPanelMeta[]): DockLayout {
  const layout = emptyLayout();
  for (const m of metas) {
    if (m.defaultVisible === false) {
      layout.hidden.push(m.id);
    } else {
      layout.zones[m.home].panels.push(m.id);
    }
  }
  for (const z of ZONE_IDS) {
    const zone = layout.zones[z];
    if (zone.panels.length && !zone.active) zone.active = zone.panels[0];
  }
  return layout;
}

/** All panel ids referenced anywhere in a layout. */
function idsIn(layout: DockLayout): Set<string> {
  const s = new Set<string>(layout.hidden);
  for (const z of ZONE_IDS) {
    layout.zones[z].panels.forEach((p) => s.add(p));
    layout.zones[z].secondary.forEach((p) => s.add(p));
  }
  layout.floating.forEach((f) => f.panels.forEach((p) => s.add(p)));
  return s;
}

/**
 * Reconcile a persisted layout against the current panel set: drop panels that
 * no longer exist, and add newly-introduced panels into their home zone so the
 * UI never silently loses a panel across a code change.
 */
function reconcile(stored: DockLayout, metas: DockPanelMeta[]): DockLayout {
  const valid = new Set(metas.map((m) => m.id));
  const layout: DockLayout = {
    zones: {
      left: normZone(stored.zones?.left, DEFAULT_SIZE.left, valid),
      right: normZone(stored.zones?.right, DEFAULT_SIZE.right, valid),
      bottom: normZone(stored.zones?.bottom, DEFAULT_SIZE.bottom, valid),
    },
    floating: (stored.floating ?? [])
      .map((f) => ({ ...f, panels: f.panels.filter((p) => valid.has(p)) }))
      .filter((f) => f.panels.length > 0),
    hidden: (stored.hidden ?? []).filter((p) => valid.has(p)),
  };
  const present = idsIn(layout);
  for (const m of metas) {
    if (present.has(m.id)) continue;
    if (m.defaultVisible === false) layout.hidden.push(m.id);
    else layout.zones[m.home].panels.push(m.id);
  }
  for (const z of ZONE_IDS) {
    let zone = layout.zones[z];
    if (zone.secondaryActive && !zone.secondary.includes(zone.secondaryActive))
      zone.secondaryActive = zone.secondary[0] ?? null;
    if (!zone.secondaryActive && zone.secondary.length) zone.secondaryActive = zone.secondary[0];
    zone = promoteSecondary(zone);
    if (zone.active && !zone.panels.includes(zone.active)) zone.active = zone.panels[0] ?? null;
    if (!zone.active && zone.panels.length) zone.active = zone.panels[0];
    layout.zones[z] = zone;
  }
  for (const f of layout.floating) {
    if (f.active && !f.panels.includes(f.active)) f.active = f.panels[0] ?? null;
    if (!f.active && f.panels.length) f.active = f.panels[0];
  }
  return layout;
}

function load(storageKey: string, metas: DockPanelMeta[]): DockLayout {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) return reconcile(JSON.parse(raw) as DockLayout, metas);
  } catch {
    /* fall through to default */
  }
  return buildDefault(metas);
}

function persist(storageKey: string, layout: DockLayout) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    /* storage may be unavailable; layout stays in-memory */
  }
}

/** Remove a panel id from every container; prune emptied floating windows. */
function detach(layout: DockLayout, id: string): DockLayout {
  const next: DockLayout = {
    zones: {
      left: { ...layout.zones.left },
      right: { ...layout.zones.right },
      bottom: { ...layout.zones.bottom },
    },
    floating: layout.floating.map((f) => ({ ...f })),
    hidden: layout.hidden.filter((p) => p !== id),
  };
  for (const z of ZONE_IDS) {
    let zone = next.zones[z];
    if (zone.panels.includes(id)) {
      zone.panels = zone.panels.filter((p) => p !== id);
      if (zone.active === id) zone.active = zone.panels[0] ?? null;
    }
    if (zone.secondary.includes(id)) {
      zone.secondary = zone.secondary.filter((p) => p !== id);
      if (zone.secondaryActive === id) zone.secondaryActive = zone.secondary[0] ?? null;
    }
    zone = promoteSecondary(zone);
    next.zones[z] = zone;
  }
  next.floating = next.floating
    .map((f) => {
      if (!f.panels.includes(id)) return f;
      const panels = f.panels.filter((p) => p !== id);
      return { ...f, panels, active: f.active === id ? panels[0] ?? null : f.active };
    })
    .filter((f) => f.panels.length > 0);
  return next;
}

export function useDockLayout(
  storageKey: string,
  metas: DockPanelMeta[],
): { layout: DockLayout; controls: DockControls } {
  // metas are stable per host; capture once so reconcile/reset stay consistent.
  const metasRef = useRef(metas);
  const [layout, setLayout] = useState<DockLayout>(() => load(storageKey, metas));
  // Always-current snapshot so read-only controls don't setState during render.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const update = useCallback(
    (fn: (cur: DockLayout) => DockLayout) => {
      setLayout((cur) => {
        const next = fn(cur);
        persist(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const controls = useMemo<DockControls>(() => {
    const locationOf = (layoutSnap: DockLayout, id: string): DockLocation => {
      for (const z of ZONE_IDS) {
        const zone = layoutSnap.zones[z];
        if (zone.panels.includes(id) || zone.secondary.includes(id)) return { kind: "zone", zone: z };
      }
      const flt = layoutSnap.floating.find((f) => f.panels.includes(id));
      if (flt) return { kind: "float", floatId: flt.id };
      if (layoutSnap.hidden.includes(id)) return { kind: "hidden" };
      return null;
    };

    return {
      isVisible: (id) => {
        const loc = locationOf(layoutRef.current, id);
        return loc !== null && loc.kind !== "hidden";
      },
      isActive: (id) => {
        const cur = layoutRef.current;
        const loc = locationOf(cur, id);
        if (loc?.kind === "zone") {
          const zone = cur.zones[loc.zone];
          return zone.secondary.includes(id) ? zone.secondaryActive === id : zone.active === id;
        }
        if (loc?.kind === "float") {
          return cur.floating.find((f) => f.id === loc.floatId)?.active === id;
        }
        return false;
      },
      locationOf: (id) => locationOf(layoutRef.current, id),
      showPanel: (id) =>
        update((cur) => {
          const loc = locationOf(cur, id);
          if (loc && loc.kind !== "hidden") return cur;
          const home = metasRef.current.find((m) => m.id === id)?.home ?? "right";
          const next = detach(cur, id);
          next.zones[home] = { ...next.zones[home], panels: [...next.zones[home].panels, id], active: id };
          return next;
        }),
      hidePanel: (id) =>
        update((cur) => {
          const next = detach(cur, id);
          if (!next.hidden.includes(id)) next.hidden.push(id);
          return next;
        }),
      togglePanel: (id) =>
        update((cur) => {
          const loc = locationOf(cur, id);
          if (loc && loc.kind !== "hidden") {
            const next = detach(cur, id);
            if (!next.hidden.includes(id)) next.hidden.push(id);
            return next;
          }
          const home = metasRef.current.find((m) => m.id === id)?.home ?? "right";
          const next = detach(cur, id);
          next.zones[home] = { ...next.zones[home], panels: [...next.zones[home].panels, id], active: id };
          return next;
        }),
      setActive: (id) =>
        update((cur) => {
          const loc = locationOf(cur, id);
          if (!loc) return cur;
          if (loc.kind === "zone") {
            const zone = cur.zones[loc.zone];
            const patch = zone.secondary.includes(id) ? { secondaryActive: id } : { active: id };
            return { ...cur, zones: { ...cur.zones, [loc.zone]: { ...zone, ...patch } } };
          }
          if (loc.kind === "float") {
            return {
              ...cur,
              floating: cur.floating.map((f) => (f.id === loc.floatId ? { ...f, active: id } : f)),
            };
          }
          return cur;
        }),
      movePanel: (id, target: DockDropTarget) =>
        update((cur) => {
          const next = detach(cur, id);
          if (target.kind === "zone") {
            const zone = next.zones[target.zone];
            // Secondary stacking is only meaningful for the side zones.
            if (target.slot === "secondary" && target.zone !== "bottom") {
              next.zones[target.zone] = {
                ...zone,
                secondary: [...zone.secondary, id],
                secondaryActive: id,
                collapsed: false,
              };
            } else {
              next.zones[target.zone] = {
                ...zone,
                panels: [...zone.panels, id],
                active: id,
                collapsed: false,
              };
            }
            return next;
          }
          if (target.kind === "float") {
            const flt = next.floating.find((f) => f.id === target.floatId);
            if (flt) {
              flt.panels = [...flt.panels, id];
              flt.active = id;
              return next;
            }
          }
          const x = target.kind === "new-float" ? target.x : 160;
          const y = target.kind === "new-float" ? target.y : 120;
          const win: DockFloatState = { id: nextFloatId(), panels: [id], active: id, x, y, w: 300, h: 340 };
          next.floating = [...next.floating, win];
          return next;
        }),
      floatPanel: (id, x, y) =>
        update((cur) => {
          const next = detach(cur, id);
          const win: DockFloatState = { id: nextFloatId(), panels: [id], active: id, x, y, w: 300, h: 340 };
          next.floating = [...next.floating, win];
          return next;
        }),
      setZoneSize: (zone, size) =>
        update((cur) => ({
          ...cur,
          zones: { ...cur.zones, [zone]: { ...cur.zones[zone], size: Math.max(140, Math.min(720, size)) } },
        })),
      toggleCollapse: (zone) =>
        update((cur) => ({
          ...cur,
          zones: { ...cur.zones, [zone]: { ...cur.zones[zone], collapsed: !cur.zones[zone].collapsed } },
        })),
      setZoneSplit: (zone, split) =>
        update((cur) => ({
          ...cur,
          zones: { ...cur.zones, [zone]: { ...cur.zones[zone], split: Math.min(0.85, Math.max(0.15, split)) } },
        })),
      setFloatRect: (floatId, rect) =>
        update((cur) => ({
          ...cur,
          floating: cur.floating.map((f) => (f.id === floatId ? { ...f, ...rect } : f)),
        })),
      resetLayout: () => update(() => buildDefault(metasRef.current)),
    };
  }, [update]);

  return { layout, controls };
}
