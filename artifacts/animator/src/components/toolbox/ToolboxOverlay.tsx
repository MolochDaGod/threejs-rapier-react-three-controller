/**
 * Toolbox overlay: a tabbed workbench. The Tools tab is the 5×5 gold tool
 * grid — every icon is a live launcher (clicking one closes the overlay and
 * runs the tool's action: mode switch, dock panel, HUD editor, loadout…).
 * The Music tab hosts the CPT RAC Station player + settings and the volume
 * mixer (content injected by the host via the `music` prop). Rendered by the
 * AppShell so it's reachable from every mode.
 */
import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { iconUrl } from "../../three/icons";
import { TOOLBOX_TOOLS, type ToolDef } from "./tools";
import "./toolbox.css";

type Tab = "tools" | "music";

interface Props {
  onLaunch: (tool: ToolDef) => void;
  onClose: () => void;
  /** Music tab content (RAC Station + volume mixer); omit to hide the tab. */
  music?: ReactNode;
}

export function ToolboxOverlay({ onLaunch, onClose, music }: Props) {
  const [tab, setTab] = useState<Tab>("tools");

  // Esc closes, same as the scrim / X button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <motion.div
      className="toolbox-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="toolbox"
        role="dialog"
        aria-modal="true"
        aria-label="Toolbox"
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="toolbox-head">
          <span className="toolbox-title">Toolbox</span>
          {music ? (
            <div className="toolbox-tabs" role="tablist" aria-label="Toolbox sections">
              <button
                className={`toolbox-tab ${tab === "tools" ? "on" : ""}`}
                role="tab"
                aria-selected={tab === "tools"}
                onClick={() => setTab("tools")}
                data-tip="Tool launchers — every icon opens where it lives"
              >
                Tools
              </button>
              <button
                className={`toolbox-tab ${tab === "music" ? "on" : ""}`}
                role="tab"
                aria-selected={tab === "music"}
                onClick={() => setTab("music")}
                data-tip="CPT RAC Station player & volume mixer"
              >
                Music
              </button>
            </div>
          ) : (
            <span className="toolbox-sub">Pick a tool — it opens where it lives</span>
          )}
          <button
            className="toolbox-close"
            onClick={onClose}
            aria-label="Close toolbox"
            data-tip="Close (Esc)"
          >
            <X size={16} />
          </button>
        </header>
        {tab === "music" && music ? (
          <div className="toolbox-music">{music}</div>
        ) : (
          <div className="toolbox-grid">
            {TOOLBOX_TOOLS.map((tool) => (
              <button
                key={tool.label}
                className="toolbox-tool"
                data-tip={tool.hint}
                onClick={() => onLaunch(tool)}
              >
                <img src={iconUrl(tool.icon)} alt="" draggable={false} loading="lazy" />
                <span className="toolbox-tool-label">{tool.label}</span>
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
