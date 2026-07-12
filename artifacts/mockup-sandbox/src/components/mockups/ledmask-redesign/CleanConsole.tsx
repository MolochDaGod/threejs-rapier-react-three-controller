import React, { useState } from "react";
import { MessageSquare, Settings2, Zap, Palette, Monitor, Mic, Captions, Maximize, X } from "lucide-react";
import "./clean-console.css";
import { LiveMaskStage } from "./LiveMaskStage";
import type { FaceType, MaskState } from "./LedMask";
import type { ShellId } from "./LedMaskShells";

const FACES: { id: FaceType; glyph: string; label: string }[] = [
  { id: "smile", glyph: "🙂", label: "SMILE" },
  { id: "happy", glyph: "😄", label: "HAPPY" },
  { id: "love", glyph: "😍", label: "LOVE" },
  { id: "wink", glyph: "😉", label: "WINK" },
  { id: "cool", glyph: "😎", label: "COOL" },
  { id: "mischief", glyph: "😈", label: "MISCHIEF" },
  { id: "surprise", glyph: "😲", label: "SURPRISE" },
  { id: "angry", glyph: "😠", label: "ANGRY" },
  { id: "sad", glyph: "😢", label: "SAD" },
  { id: "skeptical", glyph: "🤨", label: "SKEPTICAL" },
  { id: "neutral", glyph: "😐", label: "NEUTRAL" },
  { id: "sleepy", glyph: "😴", label: "SLEEPY" },
  { id: "dead", glyph: "💀", label: "DEAD" },
  { id: "matrix", glyph: "01", label: "MATRIX" },
  { id: "scan", glyph: "⟐", label: "SCAN" },
];

const SHELLS: { id: ShellId; glyph: string; label: string }[] = [
  { id: "hood", glyph: "🥷", label: "HOODED" },
  { id: "arcade", glyph: "🕹️", label: "ARCADE" },
  { id: "steampunk", glyph: "⚙️", label: "STEAMPUNK" },
  { id: "crystal", glyph: "💎", label: "CRYSTAL" },
  { id: "robot", glyph: "🤖", label: "ROBOT" },
  { id: "boombox", glyph: "📻", label: "BOOMBOX" },
  { id: "crt", glyph: "📺", label: "RETRO CRT" },
  { id: "satellite", glyph: "🛰️", label: "SATELLITE" },
];

const STATES: { id: MaskState; label: string; danger?: boolean }[] = [
  { id: "idle", label: "IDLE" },
  { id: "talk", label: "TALK" },
  { id: "shout", label: "SHOUT" },
  { id: "whisper", label: "WHISPER" },
  { id: "cast", label: "CAST" },
  { id: "attack", label: "ATTACK MODE", danger: true },
];

export default function CleanConsole() {
  const [activeTab, setActiveTab] = useState<"chat" | "appearance" | "behavior" | "actions">("chat");

  const [banner, setBanner] = useState("HIGHPEAK DIGITAL");
  const [bannerOn, setBannerOn] = useState(false);
  const [face, setFace] = useState<FaceType>("smile");
  const [shell, setShell] = useState<ShellId>("hood");
  const [state, setState] = useState<MaskState>("idle");
  const [health, setHealth] = useState(100);
  const [draft, setDraft] = useState("");
  const [activeCam, setActiveCam] = useState(false);
  const [activeMic, setActiveMic] = useState(false);
  const [activeCap, setActiveCap] = useState(false);

  return (
    <div className="lmv1-root">
      <header className="lmv1-header">
        <div className="lmv1-header-left">
          <div>
            <h1 className="lmv1-title">Voxel LED Mask</h1>
            <p className="lmv1-sub">AI companion studio</p>
          </div>
        </div>
        <div className="lmv1-header-right">
          <div className="lmv1-status">
            <span className="lmv1-status-dot" />
            AI ONLINE
          </div>
          <button className="lmv1-btn-ghost"><Maximize size={16} /> Frame</button>
          <button className="lmv1-btn-ghost"><X size={16} /> Exit</button>
        </div>
      </header>

      <div className="lmv1-main">
        <div className="lmv1-stage-container">
          <div className="lmv1-stage-wrap">
            <LiveMaskStage
              face={face}
              shell={shell}
              maskState={state}
              bannerText={banner}
              bannerOn={bannerOn}
              health={health}
              onAutoIdle={() => setState("idle")}
            />
          </div>
        </div>

        <div className="lmv1-sidebar">
          <div className="lmv1-tabs">
            <button className={`lmv1-tab ${activeTab === "chat" ? "is-active" : ""}`} onClick={() => setActiveTab("chat")}>
              Chat
            </button>
            <button className={`lmv1-tab ${activeTab === "appearance" ? "is-active" : ""}`} onClick={() => setActiveTab("appearance")}>
              Appearance
            </button>
            <button className={`lmv1-tab ${activeTab === "behavior" ? "is-active" : ""}`} onClick={() => setActiveTab("behavior")}>
              Behavior
            </button>
            <button className={`lmv1-tab ${activeTab === "actions" ? "is-active" : ""}`} onClick={() => setActiveTab("actions")}>
              Actions
            </button>
          </div>

          <div className="lmv1-tab-content">
            {activeTab === "chat" && (
              <div className="lmv1-section">
                <div className="lmv1-chat-log">
                  <div className="lmv1-msg user">
                    <div className="lmv1-bubble">How are you feeling today?</div>
                  </div>
                  <div className="lmv1-msg assistant">
                    <div className="lmv1-bubble">Feeling electric! ⚡ My LEDs are all warmed up — ask me anything.</div>
                  </div>
                </div>
                <div className="lmv1-chat-input-wrap">
                  <input
                    className="lmv1-input"
                    value={draft}
                    placeholder="Ask the mask anything…"
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button className="lmv1-btn-primary">Send</button>
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <>
                <div className="lmv1-section">
                  <div className="lmv1-section-header">
                    <h3 className="lmv1-section-title">Head Shell</h3>
                  </div>
                  <div className="lmv1-grid-shell">
                    {SHELLS.map((s) => (
                      <button
                        key={s.id}
                        className={`lmv1-grid-item ${shell === s.id ? "is-active" : ""}`}
                        onClick={() => setShell(s.id)}
                      >
                        {s.glyph}
                        <span className="lmv1-tooltip">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="lmv1-section">
                  <div className="lmv1-section-header">
                    <h3 className="lmv1-section-title">Face Options</h3>
                  </div>
                  <div className="lmv1-grid-face">
                    {FACES.map((f) => (
                      <button
                        key={f.id}
                        className={`lmv1-grid-item ${face === f.id ? "is-active" : ""}`}
                        onClick={() => setFace(f.id)}
                      >
                        {f.glyph}
                        <span className="lmv1-tooltip">{f.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === "behavior" && (
              <>
                <div className="lmv1-section">
                  <div className="lmv1-section-header">
                    <h3 className="lmv1-section-title">Active Mode</h3>
                  </div>
                  <p className="lmv1-hint">Mirror your real expression, lip-sync, and auto-caption.</p>
                  <div className="lmv1-control-row">
                    <button className={`lmv1-toggle-btn ${activeCam ? "is-active" : ""}`} onClick={() => setActiveCam(!activeCam)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Monitor size={16}/> Camera</span>
                      <div className="lmv1-toggle-indicator"><div className="lmv1-toggle-knob"/></div>
                    </button>
                    <button className={`lmv1-toggle-btn ${activeMic ? "is-active" : ""}`} onClick={() => setActiveMic(!activeMic)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Mic size={16}/> Microphone</span>
                      <div className="lmv1-toggle-indicator"><div className="lmv1-toggle-knob"/></div>
                    </button>
                    <button className={`lmv1-toggle-btn ${activeCap ? "is-active" : ""}`} onClick={() => setActiveCap(!activeCap)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Captions size={16}/> Captions</span>
                      <div className="lmv1-toggle-indicator"><div className="lmv1-toggle-knob"/></div>
                    </button>
                  </div>
                </div>
                <div className="lmv1-section" style={{ marginTop: 16 }}>
                  <div className="lmv1-section-header">
                    <h3 className="lmv1-section-title">Scrolling Banner</h3>
                  </div>
                  <button className={`lmv1-toggle-btn ${bannerOn ? "is-active" : ""}`} onClick={() => setBannerOn(!bannerOn)}>
                    <span>Enable Banner</span>
                    <div className="lmv1-toggle-indicator"><div className="lmv1-toggle-knob"/></div>
                  </button>
                  <div className="lmv1-chat-input-wrap">
                    <input
                      className="lmv1-input"
                      value={banner}
                      onChange={(e) => setBanner(e.target.value)}
                      placeholder="Type a message…"
                      style={{ fontFamily: 'monospace', letterSpacing: '1px' }}
                    />
                  </div>
                </div>
              </>
            )}

            {activeTab === "actions" && (
              <>
                <div className="lmv1-section">
                  <div className="lmv1-section-header">
                    <h3 className="lmv1-section-title">Animation States</h3>
                  </div>
                  <div className="lmv1-state-grid">
                    {STATES.map((s) => (
                      <button
                        key={s.id}
                        className={`lmv1-state-btn ${s.danger ? "is-danger" : ""} ${state === s.id ? "is-active" : ""}`}
                        onClick={() => setState(s.id)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="lmv1-section" style={{ marginTop: 16 }}>
                  <div className="lmv1-section-header">
                    <h3 className="lmv1-section-title">Combat</h3>
                  </div>
                  <div className="lmv1-state-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                    <button className="lmv1-state-btn" onClick={() => setState("cast")}>Cast</button>
                    <button className="lmv1-state-btn is-danger" onClick={() => setHealth((h) => Math.max(0, h - 18))}>Hit</button>
                    <button className="lmv1-state-btn" onClick={() => setHealth(100)}>Repair</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8b8d98', width: 60 }}>HP {health}%</span>
                    <input
                      type="range"
                      className="lmv1-range"
                      min={0}
                      max={100}
                      value={health}
                      onChange={(e) => setHealth(Number(e.target.value))}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
