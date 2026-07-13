/**
 * Toolbox overlay: a tabbed workbench anchored bottom-right. The Tools tab is
 * the 5×5 gold tool grid — every icon is a live launcher. The Music tab hosts
 * the CPT RAC Station + volume mixer. The AI tab hosts the agentic companion
 * (editor / creator / skill helper) so there is no separate floating chat UI.
 */
import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Bot, Music2, Wrench, X } from "lucide-react";
import { iconUrl } from "../../three/icons";
import { TOOLBOX_TOOLS, type ToolDef } from "./tools";
import "./toolbox.css";

export type ToolboxTab = "tools" | "music" | "ai";

interface Props {
  onLaunch: (tool: ToolDef) => void;
  onClose: () => void;
  /** Music tab content (RAC Station + volume mixer); omit to hide the tab. */
  music?: ReactNode;
  /** AI companion tab content (embedded AiAssistant); omit to hide the tab. */
  ai?: ReactNode;
  /** Which tab to show when the overlay opens. */
  initialTab?: ToolboxTab;
}

export function ToolboxOverlay({ onLaunch, onClose, music, ai, initialTab = "tools" }: Props) {
  const [tab, setTab] = useState<ToolboxTab>(initialTab);

  // If the requested initial tab is unavailable, fall back to tools.
  useEffect(() => {
    if (initialTab === "music" && !music) setTab("tools");
    else if (initialTab === "ai" && !ai) setTab("tools");
    else setTab(initialTab);
  }, [initialTab, music, ai]);

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

  const showTabs = Boolean(music || ai);

  return (
    <motion.div
      className="toolbox-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={`toolbox ${tab === "ai" ? "toolbox-ai-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Toolbox"
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="toolbox-head">
          <span className="toolbox-title">Toolbox</span>
          {showTabs ? (
            <div className="toolbox-tabs" role="tablist" aria-label="Toolbox sections">
              <button
                className={`toolbox-tab ${tab === "tools" ? "on" : ""}`}
                role="tab"
                aria-selected={tab === "tools"}
                onClick={() => setTab("tools")}
                data-tip="Tool launchers — every icon opens where it lives"
              >
                <Wrench size={12} />
                Tools
              </button>
              {music && (
                <button
                  className={`toolbox-tab ${tab === "music" ? "on" : ""}`}
                  role="tab"
                  aria-selected={tab === "music"}
                  onClick={() => setTab("music")}
                  data-tip="CPT RAC Station player & volume mixer"
                >
                  <Music2 size={12} />
                  Music
                </button>
              )}
              {ai && (
                <button
                  className={`toolbox-tab ${tab === "ai" ? "on" : ""}`}
                  role="tab"
                  aria-selected={tab === "ai"}
                  onClick={() => setTab("ai")}
                  data-tip="Agentic AI — editor, creator & animation / weapon / skill helper"
                >
                  <Bot size={12} />
                  AI
                </button>
              )}
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
        ) : tab === "ai" && ai ? (
          <div className="toolbox-ai">{ai}</div>
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
