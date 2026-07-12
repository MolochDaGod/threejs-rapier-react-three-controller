import { useState } from "react";
import "./ledmask.css";
import { LiveMaskStage } from "./LiveMaskStage";
import type { FaceType, MaskState } from "./LedMask";
import type { ShellId } from "./LedMaskShells";

/**
 * "Current" baseline — pixel-faithful static extraction of the Animator's
 * LED Mask studio (LedMaskMode.tsx). The WebGL visor, AI chat backend, and
 * camera/mic captures are stubbed with static stand-ins; every control,
 * label, and panel matches the live app.
 */

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

export function Current() {
  const [banner, setBanner] = useState("HIGHPEAK DIGITAL");
  const [bannerOn, setBannerOn] = useState(false);
  const [face, setFace] = useState<FaceType>("smile");
  const [shell, setShell] = useState<ShellId>("hood");
  const [state, setState] = useState<MaskState>("idle");
  const [health, setHealth] = useState(100);
  const [draft, setDraft] = useState("");

  return (
    <div className="ledmask">
      <div className="ledmask-head">
        <div>
          <h1 className="ledmask-title">VOXEL LED MASK</h1>
          <p className="ledmask-sub">AI companion face · talks, emotes, and watches your cursor</p>
        </div>
        <div className="ledmask-head-right">
          <span className="ledmask-live">
            <span className="ledmask-live-dot" />
            AI ONLINE
          </span>
          <button className="ledmask-exit ledmask-frame-btn">▦ Frame</button>
          <button className="ledmask-exit">⎋ Exit</button>
        </div>
      </div>

      <div className="ledmask-grid">
        <div className="ledmask-stage">
          <div className="ledmask-canvas-wrap">
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

        <div className="ledmask-controls">
          <section className="ledmask-panel">
            <div className="ledmask-panel-title">🤖 TALK TO THE MASK</div>
            <div className="ledmask-chat">
              <div className="ledmask-chat-log">
                <div className="ledmask-msg user">
                  <div className="ledmask-bubble">How are you feeling today?</div>
                </div>
                <div className="ledmask-msg assistant">
                  <div className="ledmask-bubble">
                    Feeling electric! ⚡ My LEDs are all warmed up — ask me anything.
                  </div>
                </div>
              </div>
              <div className="ledmask-chat-row">
                <textarea
                  className="ledmask-chat-input"
                  rows={1}
                  value={draft}
                  placeholder="Ask the mask anything…"
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button className="ledmask-run" title="Send">➤</button>
              </div>
              <button className="ledmask-chat-clear">🗑 Clear conversation</button>
            </div>
          </section>

          <section className="ledmask-panel">
            <div className="ledmask-panel-title">🎥 ACTIVE MODE — MIRROR YOUR FACE</div>
            <p className="ledmask-hint" style={{ margin: "0 0 10px" }}>
              Camera mirrors your real expression onto the mask · mic lip-syncs the
              mouth to your voice · speech is captioned onto the banner.
            </p>
            <div className="ledmask-active-row">
              <button className="ledmask-state">▶ CAMERA</button>
              <button className="ledmask-state">▶ MIC</button>
              <button className="ledmask-state">▶ CAPTIONS</button>
            </div>
          </section>

          <section className="ledmask-panel">
            <div className="ledmask-panel-title">📜 SCROLLING BANNER</div>
            <div className="ledmask-banner-row" style={{ marginBottom: 8, alignItems: "center" }}>
              <button
                className={"ledmask-state" + (bannerOn ? " is-active" : "")}
                onClick={() => setBannerOn(!bannerOn)}
              >
                {bannerOn ? "■ BANNER ON" : "▶ BANNER OFF"}
              </button>
              <span className="ledmask-hint" style={{ margin: 0 }}>
                Off by default. Turning captions on (or hitting RUN) switches it back on.
              </span>
            </div>
            <div className="ledmask-banner-row">
              <input
                className="ledmask-input"
                value={banner}
                onChange={(e) => setBanner(e.target.value)}
                placeholder="Type a message…"
              />
              <button className="ledmask-run" onClick={() => setBannerOn(true)}>RUN</button>
            </div>
          </section>

          <section className="ledmask-panel">
            <div className="ledmask-panel-title">🪖 HEAD SHELL</div>
            <p className="ledmask-hint" style={{ margin: "0 0 10px" }}>
              Swap the procedural housing around the LED face. Your pick is saved.
            </p>
            <div className="ledmask-faces">
              {SHELLS.map((s) => (
                <button
                  key={s.id}
                  className={"ledmask-face" + (shell === s.id ? " is-active" : "")}
                  onClick={() => setShell(s.id)}
                >
                  <span className="ledmask-face-glyph">{s.glyph}</span>
                  <span className="ledmask-face-label">{s.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="ledmask-panel">
            <div className="ledmask-panel-title">FACE OPTIONS</div>
            <div className="ledmask-faces">
              {FACES.map((f) => (
                <button
                  key={f.id}
                  className={"ledmask-face" + (face === f.id ? " is-active" : "")}
                  onClick={() => setFace(f.id)}
                >
                  <span className="ledmask-face-glyph">{f.glyph}</span>
                  <span className="ledmask-face-label">{f.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="ledmask-panel">
            <div className="ledmask-panel-title">ANIMATION STATES</div>
            <div className="ledmask-states">
              {STATES.map((s) => (
                <button
                  key={s.id}
                  className={
                    "ledmask-state" +
                    (s.danger ? " is-danger" : "") +
                    (state === s.id ? " is-active" : "")
                  }
                  onClick={() => setState(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="ledmask-hint">Shortcuts: I · T · S · W · C · A</p>
          </section>

          <section className="ledmask-panel">
            <div className="ledmask-panel-title">⚡ COMBAT — DAMAGE &amp; CASTING</div>
            <div className="ledmask-states">
              <button className="ledmask-state" onClick={() => setState("cast")}>CAST SPELL</button>
              <button className="ledmask-state is-danger" onClick={() => setHealth((h) => Math.max(0, h - 18))}>TAKE HIT</button>
              <button className="ledmask-state" onClick={() => setHealth(100)}>REPAIR</button>
            </div>
            <div className="ledmask-banner-row" style={{ marginTop: 10, alignItems: "center" }}>
              <span className="ledmask-face-label" style={{ minWidth: 64 }}>
                HEALTH {health}%
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={health}
                onChange={(e) => setHealth(Number(e.target.value))}
                style={{ flex: 1 }}
              />
            </div>
            <p className="ledmask-hint">Shortcuts: C cast · H hit · R repair</p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Current;
