import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  clampAppearance,
  clampPanel,
  defaultAppearance,
  defaultHudConfig,
  defaultPanelLayout,
  loadCustomLooks,
  loadHudConfig,
  makeCustomLook,
  MAX_LOOKS,
  saveCustomLooks,
  saveHudConfig,
  type HudAppearance,
  type HudConfig,
  type HudCustomLook,
  type HudLayoutId,
  type HudPanelId,
  type PanelLayout,
} from "./hudConfig";
import type { HudThemeId } from "./hudThemes";
import { isQuickActionId, QUICK_SLOT_COUNT, type QuickActionId } from "./quickActions";

/** Props spread onto an editable HUD panel's root element. */
export interface HudPanelBinding {
  "data-hud-panel": HudPanelId;
  className: string;
  style: CSSProperties;
  onPointerDown?: (e: ReactPointerEvent) => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
}

/** Everything the HUD components need to render layout + (optionally) edit. */
export interface HudEditApi {
  config: HudConfig;
  editing: boolean;
  selected: HudPanelId | null;
  bind: (id: HudPanelId) => HudPanelBinding;
}

export interface HudEditorControls {
  config: HudConfig;
  selected: HudPanelId | null;
  setSelected: (id: HudPanelId | null) => void;
  setTheme: (theme: HudThemeId) => void;
  /** Switch between the classic bottom bar and the HUD_tight 6+6 quick menus. */
  setLayout: (layout: HudLayoutId) => void;
  /** Rebind one HUD_tight quick-menu slot (0-5 left, 6-11 right); null empties it. */
  setQuickSlot: (index: number, action: QuickActionId | null) => void;
  setAppearance: (patch: Partial<HudAppearance>) => void;
  resetAppearance: () => void;
  setPanel: (id: HudPanelId, patch: Partial<PanelLayout>) => void;
  toggleHidden: (id: HudPanelId) => void;
  resetPanel: (id: HudPanelId) => void;
  resetAll: () => void;
  /** Player-saved theme + appearance snapshots. */
  looks: HudCustomLook[];
  /** True once the saved-look count hits MAX_LOOKS (the Save action disables). */
  looksFull: boolean;
  /** Snapshot the current theme + appearance under a name. */
  saveLook: (name: string) => void;
  /** Re-apply a saved look's theme + appearance to the live config. */
  applyLook: (id: string) => void;
  /** Forget a saved look. */
  deleteLook: (id: string) => void;
  /** Build the render/edit api consumed by the HUD components. */
  api: (editing: boolean) => HudEditApi;
}

const DRAG_THRESHOLD = 2;

export function useHudEditor(): HudEditorControls {
  const [config, setConfig] = useState<HudConfig>(() => loadHudConfig());
  const [selected, setSelected] = useState<HudPanelId | null>(null);
  const [looks, setLooks] = useState<HudCustomLook[]>(() => loadCustomLooks());

  // Always-current snapshot so pointer handlers read fresh layout mid-drag.
  const configRef = useRef(config);
  configRef.current = config;

  const update = useCallback((fn: (cur: HudConfig) => HudConfig) => {
    setConfig((cur) => {
      const next = fn(cur);
      saveHudConfig(next);
      return next;
    });
  }, []);

  const updateLooks = useCallback((fn: (cur: HudCustomLook[]) => HudCustomLook[]) => {
    setLooks((cur) => {
      const next = fn(cur);
      saveCustomLooks(next);
      return next;
    });
  }, []);

  const saveLook = useCallback(
    (name: string) => {
      const look = makeCustomLook(name, configRef.current);
      if (!look.name) return; // ignore empty / whitespace-only names
      updateLooks((cur) => (cur.length >= MAX_LOOKS ? cur : [look, ...cur]));
    },
    [updateLooks],
  );

  const applyLook = useCallback(
    (id: string) =>
      setLooks((cur) => {
        const look = cur.find((l) => l.id === id);
        if (look) {
          update((c) => ({ ...c, theme: look.theme, appearance: clampAppearance(look.appearance) }));
        }
        return cur;
      }),
    [update],
  );

  const deleteLook = useCallback(
    (id: string) => updateLooks((cur) => cur.filter((l) => l.id !== id)),
    [updateLooks],
  );

  const setTheme = useCallback(
    (theme: HudThemeId) => update((cur) => ({ ...cur, theme })),
    [update],
  );

  const setLayout = useCallback(
    (layout: HudLayoutId) => update((cur) => ({ ...cur, layout })),
    [update],
  );

  const setQuickSlot = useCallback(
    (index: number, action: QuickActionId | null) =>
      update((cur) => {
        if (!Number.isInteger(index) || index < 0 || index >= QUICK_SLOT_COUNT) return cur;
        if (action !== null && !isQuickActionId(action)) return cur;
        const quickSlots = cur.quickSlots.slice();
        quickSlots[index] = action;
        return { ...cur, quickSlots };
      }),
    [update],
  );

  const setAppearance = useCallback(
    (patch: Partial<HudAppearance>) =>
      update((cur) => ({ ...cur, appearance: { ...cur.appearance, ...patch } })),
    [update],
  );

  const resetAppearance = useCallback(
    () => update((cur) => ({ ...cur, appearance: defaultAppearance() })),
    [update],
  );

  const setPanel = useCallback(
    (id: HudPanelId, patch: Partial<PanelLayout>) =>
      update((cur) => ({
        ...cur,
        panels: { ...cur.panels, [id]: clampPanel({ ...cur.panels[id], ...patch }) },
      })),
    [update],
  );

  const toggleHidden = useCallback(
    (id: HudPanelId) =>
      update((cur) => ({
        ...cur,
        panels: { ...cur.panels, [id]: { ...cur.panels[id], hidden: !cur.panels[id].hidden } },
      })),
    [update],
  );

  const resetPanel = useCallback(
    (id: HudPanelId) =>
      update((cur) => ({ ...cur, panels: { ...cur.panels, [id]: defaultPanelLayout() } })),
    [update],
  );

  const resetAll = useCallback(() => update(() => defaultHudConfig()), [update]);

  // Bind a single panel root: applies layout CSS vars, and (when editing) wires
  // drag-to-move + select handlers. The transform itself lives in CSS so each
  // panel keeps its anchor (e.g. the action bar's translateX(-50%)).
  const makeBind = useCallback(
    (editing: boolean) =>
      (id: HudPanelId): HudPanelBinding => {
        const layout = configRef.current.panels[id] ?? defaultPanelLayout();
        const style: CSSProperties = {
          ["--hud-dx" as string]: `${layout.dx}px`,
          ["--hud-dy" as string]: `${layout.dy}px`,
          ["--hud-scale" as string]: `${layout.scale}`,
        };
        if (layout.hidden) style.display = "none";

        if (!editing) {
          return { "data-hud-panel": id, className: "", style };
        }

        let cls = "hud-editable";
        if (selected === id) cls += " hud-selected";

        const onPointerDown = (e: ReactPointerEvent) => {
          // Ignore non-primary buttons and clicks on interactive children.
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest("button, input, a, select")) return;
          e.preventDefault();
          e.stopPropagation();
          setSelected(id);
          const start = configRef.current.panels[id] ?? defaultPanelLayout();
          const startX = e.clientX;
          const startY = e.clientY;
          let moved = false;

          const onMove = (ev: PointerEvent) => {
            const ddx = ev.clientX - startX;
            const ddy = ev.clientY - startY;
            if (!moved && Math.hypot(ddx, ddy) < DRAG_THRESHOLD) return;
            moved = true;
            setPanel(id, { dx: start.dx + ddx, dy: start.dy + ddy });
          };
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        };

        const onContextMenu = (e: ReactMouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setSelected(id);
        };

        return { "data-hud-panel": id, className: cls, style, onPointerDown, onContextMenu };
      },
    [selected, setPanel],
  );

  const api = useCallback(
    (editing: boolean): HudEditApi => ({
      config: configRef.current,
      editing,
      selected,
      bind: makeBind(editing),
    }),
    [selected, makeBind],
  );

  return useMemo(
    () => ({
      config,
      selected,
      setSelected,
      setTheme,
      setLayout,
      setQuickSlot,
      setAppearance,
      resetAppearance,
      setPanel,
      toggleHidden,
      resetPanel,
      resetAll,
      looks,
      looksFull: looks.length >= MAX_LOOKS,
      saveLook,
      applyLook,
      deleteLook,
      api,
    }),
    [
      config,
      selected,
      setTheme,
      setLayout,
      setQuickSlot,
      setAppearance,
      resetAppearance,
      setPanel,
      toggleHidden,
      resetPanel,
      resetAll,
      looks,
      saveLook,
      applyLook,
      deleteLook,
      api,
    ],
  );
}
