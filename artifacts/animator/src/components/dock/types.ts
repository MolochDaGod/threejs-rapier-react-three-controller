import type { ReactNode } from "react";

/** The three edge-pinned dock zones. Panels also live in floating windows. */
export type DockZoneId = "left" | "right" | "bottom";

/** A registered, dockable panel. `render` is called every host render. */
export interface DockPanelDef {
  id: string;
  title: string;
  /** Small glyph/icon shown on the tab. */
  icon?: ReactNode;
  /** Default zone the panel lives in (used on first run + reset). */
  home: DockZoneId;
  render: () => ReactNode;
}

/** Stable per-panel metadata used to reconcile a persisted layout. */
export interface DockPanelMeta {
  id: string;
  home: DockZoneId;
  /** Whether the panel is shown by default on a fresh layout. */
  defaultVisible?: boolean;
}

export interface DockZoneState {
  panels: string[];
  active: string | null;
  /** Width (left/right) or height (bottom) in px. */
  size: number;
  collapsed: boolean;
  /**
   * Optional secondary (stacked) panel group for left/right zones. When this has
   * panels, the zone splits top/bottom: `panels` render on top, `secondary` below,
   * with a draggable divider. `split` is the top group's height fraction (0..1).
   */
  secondary: string[];
  secondaryActive: string | null;
  split: number;
}

export interface DockFloatState {
  id: string;
  panels: string[];
  active: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DockLayout {
  zones: Record<DockZoneId, DockZoneState>;
  floating: DockFloatState[];
  /** Panel ids currently not shown anywhere. */
  hidden: string[];
}

/** Where a panel currently lives. */
export type DockLocation =
  | { kind: "zone"; zone: DockZoneId }
  | { kind: "float"; floatId: string }
  | { kind: "hidden" }
  | null;

/** A drop target resolved during a tab drag. */
export type DockDropTarget =
  | { kind: "zone"; zone: DockZoneId; slot?: "primary" | "secondary" }
  | { kind: "float"; floatId: string }
  | { kind: "new-float"; x: number; y: number };

/** Imperative controls shared between the menubar and the dock surface. */
export interface DockControls {
  showPanel: (id: string) => void;
  hidePanel: (id: string) => void;
  togglePanel: (id: string) => void;
  isVisible: (id: string) => boolean;
  /** Whether the panel is the active (front) tab of its current container/stack. */
  isActive: (id: string) => boolean;
  locationOf: (id: string) => DockLocation;
  resetLayout: () => void;
  setActive: (id: string) => void;
  /** Move a panel onto a resolved drop target. */
  movePanel: (id: string, target: DockDropTarget) => void;
  /** Pop a panel out into its own floating window near (x, y). */
  floatPanel: (id: string, x: number, y: number) => void;
  setZoneSize: (zone: DockZoneId, size: number) => void;
  toggleCollapse: (zone: DockZoneId) => void;
  /** Set the top/bottom split fraction (0..1) for a side zone holding two stacks. */
  setZoneSplit: (zone: DockZoneId, split: number) => void;
  setFloatRect: (floatId: string, rect: Partial<Pick<DockFloatState, "x" | "y" | "w" | "h">>) => void;
}
