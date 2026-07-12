import { useState } from "react";
import { Camera, Mic, Type, MessageSquare, Send, Trash2, Shield, Settings2, Play, Circle, CircleStop, MonitorPlay, Zap, Activity } from "lucide-react";
import "./FriendlyStudio.css";
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

export default function FriendlyStudio() {
  const [banner, setBanner] = useState("HIGHPEAK DIGITAL");
  const [bannerOn, setBannerOn] = useState(false);
  const [face, setFace] = useState<FaceType>("smile");
  const [shell, setShell] = useState<ShellId>("hood");
  const [state, setState] = useState<MaskState>("idle");
  const [health, setHealth] = useState(100);
  const [draft, setDraft] = useState("");
  
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [ccOn, setCcOn] = useState(false);

  return (
    <div className="lmv2-root">
      <div className="lmv2-topbar">
        <div className="lmv2-header-left">
          <div className="lmv2-logo">
            <span className="lmv2-logo-icon">✨</span>
            <div>
              <h1 className="lmv2-title">LED Companion</h1>
              <p className="lmv2-subtitle">Your voxel AI friend</p>
            </div>
          </div>
        </div>
        <div className="lmv2-header-right">
          <div className="lmv2-status-pill">
            <span className="lmv2-status-dot"></span>
            AI Online
          </div>
          <div className="lmv2-top-actions">
            <button className="lmv2-btn lmv2-btn-secondary">Frame</button>
            <button className="lmv2-btn lmv2-btn-primary">Exit Studio</button>
          </div>
        </div>
      </div>

      <div className="lmv2-layout">
        {/* Main Column: Stage + Chat */}
        <div className="lmv2-main">
          <div className="lmv2-stage-container">
            <div className="lmv2-live-stage" style={{ position: "relative", aspectRatio: "4 / 3", borderRadius: 20, overflow: "hidden", background: "#130e1a" }}>
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
            
            {/* Quick Actions overlayed/attached to stage */}
            <div className="lmv2-quick-actions">
              <button 
                className={`lmv2-quick-toggle ${camOn ? "active" : ""}`}
                onClick={() => setCamOn(!camOn)}
                title="Toggle Camera Mirror"
              >
                <Camera size={18} />
              </button>
              <button 
                className={`lmv2-quick-toggle ${micOn ? "active" : ""}`}
                onClick={() => setMicOn(!micOn)}
                title="Toggle Mic Sync"
              >
                <Mic size={18} />
              </button>
              <button 
                className={`lmv2-quick-toggle ${ccOn ? "active" : ""}`}
                onClick={() => setCcOn(!ccOn)}
                title="Toggle Captions"
              >
                <Type size={18} />
              </button>
            </div>
          </div>

          <div className="lmv2-chat-section lmv2-card">
            <div className="lmv2-card-header">
              <h2 className="lmv2-card-title"><MessageSquare size={16} /> Chat with Companion</h2>
              <button className="lmv2-icon-btn" title="Clear chat"><Trash2 size={14} /></button>
            </div>
            
            <div className="lmv2-chat-log">
              <div className="lmv2-msg lmv2-msg-user">
                <div className="lmv2-bubble">How are you feeling today?</div>
              </div>
              <div className="lmv2-msg lmv2-msg-ai">
                <div className="lmv2-ai-avatar">✨</div>
                <div className="lmv2-bubble">
                  Feeling bright and warm! ☀️ My LEDs are glowing and I'm ready to hang out.
                </div>
              </div>
            </div>
            
            <div className="lmv2-chat-input-area">
              <input
                className="lmv2-chat-input"
                value={draft}
                placeholder="Say something nice..."
                onChange={(e) => setDraft(e.target.value)}
              />
              <button className="lmv2-send-btn"><Send size={16} /></button>
            </div>
          </div>
          
          <div className="lmv2-card">
            <div className="lmv2-card-header">
              <h2 className="lmv2-card-title"><MonitorPlay size={16} /> Scrolling Banner</h2>
              <button 
                className={`lmv2-toggle-pill ${bannerOn ? "active" : ""}`}
                onClick={() => setBannerOn(!bannerOn)}
              >
                {bannerOn ? "Enabled" : "Disabled"}
              </button>
            </div>
            <div className="lmv2-banner-input-wrap">
              <input 
                className="lmv2-banner-input" 
                value={banner}
                onChange={(e) => setBanner(e.target.value)}
                placeholder="Message to scroll..."
              />
              <button className="lmv2-btn lmv2-btn-primary" onClick={() => setBannerOn(true)}>
                <Play size={14} /> Run
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar: Tuning & Personalization */}
        <div className="lmv2-sidebar">
          
          <div className="lmv2-card">
            <div className="lmv2-card-header">
              <h2 className="lmv2-card-title">Expressions</h2>
            </div>
            <div className="lmv2-face-grid">
              {FACES.map((f) => (
                <button
                  key={f.id}
                  className={`lmv2-face-btn ${face === f.id ? "active" : ""}`}
                  onClick={() => setFace(f.id)}
                  title={f.label}
                >
                  <span className="lmv2-face-emoji">{f.glyph}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="lmv2-card">
            <div className="lmv2-card-header">
              <h2 className="lmv2-card-title">Companion Shell</h2>
            </div>
            <div className="lmv2-shell-grid">
              {SHELLS.map((s) => (
                <button
                  key={s.id}
                  className={`lmv2-shell-btn ${shell === s.id ? "active" : ""}`}
                  onClick={() => setShell(s.id)}
                >
                  <span className="lmv2-shell-emoji">{s.glyph}</span>
                  <span className="lmv2-shell-label">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="lmv2-card">
            <div className="lmv2-card-header">
              <h2 className="lmv2-card-title"><Activity size={16} /> Animations</h2>
            </div>
            <div className="lmv2-state-grid">
              {STATES.map((s) => (
                <button
                  key={s.id}
                  className={`lmv2-state-btn ${s.danger ? "danger" : ""} ${state === s.id ? "active" : ""}`}
                  onClick={() => setState(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          
          <div className="lmv2-card lmv2-combat-card">
            <div className="lmv2-card-header">
              <h2 className="lmv2-card-title"><Shield size={16} /> Action Testing</h2>
            </div>
            <div className="lmv2-combat-actions">
              <button className="lmv2-btn lmv2-btn-action" onClick={() => setState("cast")}><Zap size={14}/> Cast</button>
              <button className="lmv2-btn lmv2-btn-danger" onClick={() => setHealth((h) => Math.max(0, h - 18))}>Hit</button>
              <button className="lmv2-btn lmv2-btn-success" onClick={() => setHealth(100)}>Repair</button>
            </div>
            <div className="lmv2-health-row">
              <div className="lmv2-health-label">Health: {health}%</div>
              <input
                type="range"
                className="lmv2-slider"
                min={0}
                max={100}
                value={health}
                onChange={(e) => setHealth(Number(e.target.value))}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
