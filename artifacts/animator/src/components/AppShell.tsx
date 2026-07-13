/**
 * Unified, phone-first app chrome.
 *
 * Wraps every mode's content in one persistent shell so the user can hop between
 * systems (Danger Room, Voxel Editor, Dressing Room, Lobby, LED Mask) WITHOUT a
 * doors round-trip. Chrome layout:
 *   1. Top-left mode title — click opens the system switcher dropdown.
 *   2. Bottom-right Toolbox — tools grid, music, and the agentic AI chat tab
 *      (no separate floating AI dock).
 *
 * Modes that own a live engine (the Dressing Room) register their assistant via
 * {@link useRegisterAssistant}; the shell prefers that child-registered config
 * over the `assistant` base config the host passes for the active mode.
 */
import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CursorManager } from "./CursorManager";
import {
  Boxes,
  ChevronDown,
  Home,
  Move,
  RotateCcw,
  ScanFace,
  Shirt,
  SquareUser,
  Swords,
  Globe2,
  Pickaxe,
  Users,
  X,
} from "lucide-react";
import { AiAssistant } from "../ai/AiAssistant";
import { AssistantSurfaceContext, type AssistantConfig } from "../ai/AssistantSurface";
import { useDevice } from "../hooks/useDevice";
import { WalletProvider } from "../wallet/useWallet";
import { WalletButton } from "../wallet/WalletButton";
import { TipLayer } from "./ui/TipLayer";
import { ToolboxOverlay, type ToolboxTab } from "./toolbox/ToolboxOverlay";
import type { ToolDef } from "./toolbox/tools";
import { useUiEdit } from "./shell/useUiEdit";
import "./appShell.css";

const toolboxArt = `${import.meta.env.BASE_URL}emblem.png`;

/** Every mode the shell can route to. Mirrors App's `Mode` union. */
export type ShellMode =
  | "landing"
  | "doors"
  | "danger"
  | "voxel"
  | "play"
  | "editor"
  | "lobby"
  | "lobbyWorld"
  | "characters"
  | "minegrudge"
  | "ledmask"
  | "avatar";

interface NavItem {
  mode: ShellMode;
  label: string;
  hint: string;
  icon: ReactNode;
  tone: string;
}

const NAV: NavItem[] = [
  { mode: "doors", label: "Home", hint: "Facility entrance", icon: <Home size={20} />, tone: "#7fb0ff" },
  { mode: "danger", label: "Danger Room", hint: "Combat sandbox", icon: <Swords size={20} />, tone: "#ff7a7a" },
  { mode: "voxel", label: "Voxel Editor", hint: "Build & test maps", icon: <Boxes size={20} />, tone: "#7ee0a0" },
  { mode: "editor", label: "Dressing Room", hint: "Dress up a rig", icon: <Shirt size={20} />, tone: "#ffb24d" },
  { mode: "lobby", label: "Lobby", hint: "Rooms & community", icon: <Users size={20} />, tone: "#9d8bff" },
  { mode: "lobbyWorld", label: "GRUDOX World", hint: "Persistent island", icon: <Globe2 size={20} />, tone: "#5fd48a" },
  { mode: "characters", label: "Characters", hint: "Campfire roster", icon: <SquareUser size={20} />, tone: "#4fc3ff" },
  { mode: "minegrudge", label: "Realms", hint: "Survival multiplayer", icon: <Pickaxe size={20} />, tone: "#7ee0a0" },
  { mode: "avatar", label: "Avatar Edit", hint: "Cube head builder", icon: <SquareUser size={20} />, tone: "#ffd28a" },
  { mode: "ledmask", label: "LED Mask", hint: "LED Mask & rooms", icon: <ScanFace size={20} />, tone: "#5fe0ff" },
];

/** The title pill reflects the active surface (play folds into the editor). */
function activeNav(mode: ShellMode): NavItem {
  const voxel = NAV.find((n) => n.mode === "voxel")!;
  if (mode === "play") return { ...voxel, label: "Playtest", hint: "Testing your map" };
  return NAV.find((n) => n.mode === mode) ?? NAV[0];
}

interface Props {
  /** Current mode (drives the title label + active highlight). */
  mode: ShellMode;
  /** Switch systems. The host wires in any per-mode teardown (e.g. net leave). */
  onNavigate: (mode: ShellMode) => void;
  /** Base assistant config for the active mode (null = no host-owned config). */
  assistant: AssistantConfig | null;
  /** Suppress the AI tab (e.g. LED Mask runs its own embedded face chat). */
  hideAssistant?: boolean;
  /** Launch a Toolbox tool (mode switch / panel open). Host-owned side effects. */
  onTool?: (tool: ToolDef) => void;
  /** Toolbox Music tab content (RAC Station + volume mixer), host-owned state. */
  toolboxMusic?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  mode,
  onNavigate,
  assistant,
  hideAssistant,
  onTool,
  toolboxMusic,
  children,
}: Props) {
  const { deviceClass } = useDevice();
  const phone = deviceClass === "phone";
  const [navOpen, setNavOpen] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [toolboxTab, setToolboxTab] = useState<ToolboxTab>("tools");
  // UI edit mode: drag the shell chrome (title / wallet / toolbox) to new
  // places; offsets persist to localStorage and apply as CSS vars.
  const uiEdit = useUiEdit();
  // A mode that owns its engine can override the host-provided config.
  const [override, setOverride] = useState<AssistantConfig | null>(null);

  const surfaceApi = useMemo(() => ({ set: setOverride }), []);
  const current = activeNav(mode);
  const config = override ?? assistant;
  const showAi = Boolean(config && !hideAssistant);

  const go = (next: ShellMode) => {
    setNavOpen(false);
    if (next !== mode) onNavigate(next);
  };

  const openToolbox = (tab: ToolboxTab = "tools") => {
    setNavOpen(false);
    setToolboxTab(tab);
    setToolboxOpen(true);
  };

  return (
    <CursorManager>
    <AssistantSurfaceContext.Provider value={surfaceApi}>
      <WalletProvider>
      {children}

      <TipLayer />

      {(() => {
        const b = uiEdit.bind("wallet");
        return (
          <div
            style={{ display: "contents", ...b.style }}
            className={b.className}
            onPointerDownCapture={b.onPointerDownCapture}
            onClickCapture={b.onClickCapture}
          >
            <WalletButton />
          </div>
        );
      })()}

      {/* Top-left mode title — click opens the system switcher. */}
      {(() => {
        const b = uiEdit.bind("topbar");
        return (
          <div
            className={`shell-topbar ${b.className}`}
            style={b.style}
            onPointerDownCapture={b.onPointerDownCapture}
            onClickCapture={b.onClickCapture}
          >
            <button
              className="shell-launcher"
              onClick={() => {
                setToolboxOpen(false);
                setNavOpen((v) => !v);
              }}
              aria-haspopup="menu"
              aria-expanded={navOpen}
              data-tip="Switch system — jump to any room"
              data-cursor="interact"
            >
              <span className="shell-launcher-icon" style={{ color: current.tone }}>
                {navOpen ? <X size={18} /> : current.icon}
              </span>
              <span className="shell-launcher-label">{current.label}</span>
              <ChevronDown size={15} className={`shell-launcher-chev ${navOpen ? "open" : ""}`} />
            </button>
            <button
              className={`shell-uiedit-toggle ${uiEdit.editing ? "on" : ""}`}
              onClick={() => {
                setNavOpen(false);
                setToolboxOpen(false);
                uiEdit.setEditing(!uiEdit.editing);
              }}
              aria-pressed={uiEdit.editing}
              aria-label="Edit UI layout"
              data-tip="Edit UI — drag the title, wallet & toolbox to new places"
            >
              <Move size={15} />
            </button>
          </div>
        );
      })()}

      {/* Bottom-right Toolbox launcher (tools + music + AI tabs). */}
      {onTool && (() => {
        const b = uiEdit.bind("toolbox");
        return (
          <button
            className={`shell-toolbox ${toolboxOpen ? "on" : ""} ${b.className}`}
            style={b.style}
            onPointerDownCapture={b.onPointerDownCapture}
            onClickCapture={b.onClickCapture}
            onClick={() => {
              if (toolboxOpen) setToolboxOpen(false);
              else openToolbox("tools");
            }}
            aria-haspopup="dialog"
            aria-expanded={toolboxOpen}
            data-tip="Toolbox — tools, music & AI companion"
          >
            <img className="shell-toolbox-art" src={toolboxArt} alt="" draggable={false} />
            <span className="shell-toolbox-label">Toolbox</span>
          </button>
        );
      })()}

      {uiEdit.editing && (
        <div className="shell-uiedit-chip" role="toolbar" aria-label="UI edit controls">
          <span className="shell-uiedit-chip-text">
            UI edit — drag the title, wallet or toolbox. Positions save automatically.
          </span>
          <button
            className="shell-uiedit-btn"
            onClick={uiEdit.reset}
            data-tip="Put everything back to its stock position"
          >
            <RotateCcw size={13} /> Reset
          </button>
          <button
            className="shell-uiedit-btn done"
            onClick={() => uiEdit.setEditing(false)}
            data-tip="Finish editing"
          >
            Done
          </button>
        </div>
      )}

      <AnimatePresence>
        {toolboxOpen && onTool && (
          <ToolboxOverlay
            music={toolboxMusic}
            ai={
              showAi && config ? (
                <AiAssistant
                  key={config.surface}
                  embedded
                  surface={config.surface}
                  title={config.title}
                  tools={config.tools}
                  getSystemPrompt={config.getSystemPrompt}
                  placeholder={config.placeholder}
                />
              ) : undefined
            }
            initialTab={toolboxTab}
            onClose={() => setToolboxOpen(false)}
            onLaunch={(tool) => {
              setToolboxOpen(false);
              onTool(tool);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {navOpen && (
          <>
            <motion.div
              className="shell-nav-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setNavOpen(false)}
            />
            <motion.div
              className={`shell-nav ${phone ? "sheet" : "popover"}`}
              style={phone ? undefined : uiEdit.bind("topbar").style}
              role="menu"
              initial={phone ? { y: "100%" } : { opacity: 0, y: -8, scale: 0.97 }}
              animate={phone ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
              exit={phone ? { y: "100%" } : { opacity: 0, y: -8, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
              {phone && <div className="shell-nav-grip" />}
              <div className="shell-nav-head">Switch system</div>
              <div className="shell-nav-list">
                {NAV.map((item) => {
                  const active = item.mode === mode || (mode === "play" && item.mode === "voxel");
                  return (
                    <button
                      key={item.mode}
                      className={`shell-nav-item ${active ? "active" : ""}`}
                      role="menuitem"
                      onClick={() => go(item.mode)}
                    >
                      <span className="shell-nav-item-icon" style={{ color: item.tone }}>
                        {item.icon}
                      </span>
                      <span className="shell-nav-item-text">
                        <span className="shell-nav-item-label">{item.label}</span>
                        <span className="shell-nav-item-hint">{item.hint}</span>
                      </span>
                      {active && <span className="shell-nav-item-dot" style={{ background: item.tone }} />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      </WalletProvider>
    </AssistantSurfaceContext.Provider>
    </CursorManager>
  );
}
