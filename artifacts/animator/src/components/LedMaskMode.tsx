import { useEffect, useRef, useState } from "react";
import { Send, Trash2, DoorOpen, LayoutPanelTop } from "lucide-react";
import { LedMask, type FaceType, type MaskState } from "../three/LedMask";
import { SHELLS, type ShellId } from "../three/LedMaskShells";
import { FaceTracker } from "../three/live/FaceTracker";
import { MicLipSync } from "../three/live/MicLipSync";
import { Captioner } from "../three/live/Captioner";
import { useAssistant } from "../ai/useAssistant";
import { companionSystemPrompt, parseMood } from "../ai/companionPrompt";
import { FrameSkinModal } from "./FrameSkinModal";
import { FRAME_NONE, findFrame, loadFrameId, saveFrameId } from "./ledMaskFrames";
import { MASK_ROOMS } from "./ledMaskRooms";

interface Props {
  onExit: () => void;
}

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

const STATES: { id: MaskState; label: string; danger?: boolean }[] = [
  { id: "idle", label: "IDLE" },
  { id: "talk", label: "TALK" },
  { id: "shout", label: "SHOUT" },
  { id: "whisper", label: "WHISPER" },
  { id: "cast", label: "CAST" },
  { id: "attack", label: "ATTACK MODE", danger: true },
];

// Numeric-keypad shortcuts for instant face changes (mirrors the physical keypad
// layout). Keyed by `e.code` so they only fire on the actual numpad, with an
// `e.key` symbol fallback for keyboards without a dedicated keypad.
const FACE_NUMPAD: Record<string, FaceType> = {
  NumpadDivide: "smile", // /
  NumpadMultiply: "happy", // *
  NumpadSubtract: "love", // -
  Numpad3: "sleepy", // 3
  NumpadAdd: "matrix", // +
  NumpadDecimal: "scan", // .
};
const FACE_SYMBOL: Record<string, FaceType> = {
  "/": "smile",
  "*": "happy",
  "-": "love",
  "+": "matrix",
  ".": "scan",
};

/**
 * Voxel LED Mask studio — an interactive AI face. A hooded voxel cube head with
 * an LED visor that: chats via the OpenAI assistant (its reply mood drives the
 * on-face expression and a live talk animation), tracks the pointer with its
 * eyes, and is always wearing an expression. Manual face/state/combat controls
 * remain for live tuning. Backed by {@link LedMask}.
 */
/** Friendly explanation for a getUserMedia failure (iframe blocks are common). */
function describeMediaError(err: unknown, device: string): string {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return `${device} permission blocked. The embedded preview often disables this — open the app in a new browser tab (↗) and allow ${device.toLowerCase()} access.`;
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return `No ${device.toLowerCase()} device was found.`;
  return `Could not start ${device.toLowerCase()}. Try opening the app in a browser tab and allowing access.`;
}

export function LedMaskMode({ onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<LedMask | null>(null);
  const [banner, setBanner] = useState("HIGHPEAK DIGITAL");
  const [bannerOn, setBannerOn] = useState(false);
  const [face, setFace] = useState<FaceType>("smile");
  const [shell, setShell] = useState<ShellId>("hood");
  const [state, setState] = useState<MaskState>("idle");
  const [health, setHealth] = useState(1);
  const [webglFailed, setWebglFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [frameId, setFrameId] = useState<string>(loadFrameId);
  const [frameModal, setFrameModal] = useState(false);

  const frame = frameId === FRAME_NONE ? undefined : findFrame(frameId);
  // Draw the chosen tile as a 9-slice bezel: a transparent solid border whose
  // width insets the canvas, with the sliced image (incl. `fill` centre) painted
  // into that border region.
  const stageFrameStyle = frame
    ? {
        borderStyle: "solid" as const,
        borderWidth: "clamp(20px, 4.5vw, 42px)",
        borderColor: "transparent",
        borderImage: `url(${frame.src}) ${frame.slice} fill / 1 / 0 stretch`,
        background: "transparent",
      }
    : undefined;

  const pickFrame = (id: string) => {
    setFrameId(id);
    saveFrameId(id);
  };

  // Active Mode: live webcam→expression, mic→lip-sync, speech→captions.
  const faceRef = useRef<FaceTracker | null>(null);
  const micRef = useRef<MicLipSync | null>(null);
  const capRef = useRef<Captioner | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const liveFaceRef = useRef<FaceType | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [ccOn, setCcOn] = useState(false);
  const [camLoading, setCamLoading] = useState(false);
  const [micLoading, setMicLoading] = useState(false);
  const [liveCaption, setLiveCaption] = useState("");
  const [activeErr, setActiveErr] = useState("");
  const mediaSupported = FaceTracker.isSupported();
  const captionsSupported = Captioner.isSupported();

  const { messages, streaming, ready, send, clear } = useAssistant({
    surface: "companion",
    tools: [],
    getSystemPrompt: companionSystemPrompt,
  });
  const logRef = useRef<HTMLDivElement | null>(null);
  // Last mood applied to the face, so we only re-ignite on a genuine change.
  const lastMoodRef = useRef<string>("");
  // Mirror `streaming` + the last mic-driven state into refs so the long-lived
  // mic callback reads current values without being torn down on each change.
  const streamingRef = useRef(false);
  const micStateRef = useRef<MaskState>("idle");

  useEffect(() => {
    if (!canvasRef.current) return;
    const m = new LedMask(canvasRef.current);
    maskRef.current = m;
    m.onAutoIdle = () => setState("idle");
    setWebglFailed(m.webglFailed);
    setShell(m.getShell()); // restore the persisted housing shell
    return () => {
      m.dispose();
      maskRef.current = null;
    };
  }, []);

  // Keyboard shortcuts mirror the original prototype (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      // Numeric keypad → instant face change.
      const faceKey = FACE_NUMPAD[e.code] ?? FACE_SYMBOL[e.key];
      if (faceKey) {
        e.preventDefault();
        return applyFace(faceKey);
      }
      const k = e.key.toLowerCase();
      if (k === "c") return castSpell();
      if (k === "h") return takeHit();
      if (k === "r") return repair();
      const map: Record<string, MaskState> = { i: "idle", t: "talk", s: "shout", w: "whisper", a: "attack" };
      const next = map[k];
      if (next) applyState(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive the on-face expression from the assistant's mood tag the moment it
  // streams in. The reply text itself is never drawn on the visor (chat only).
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const { mood } = parseMood(last.content);
    if (mood && mood !== lastMoodRef.current) {
      lastMoodRef.current = mood;
      setFace(mood);
      maskRef.current?.setFace(mood);
    }
  }, [messages]);

  // The mask "speaks" (mouth animation) while a reply streams, then settles.
  useEffect(() => {
    const m = maskRef.current;
    if (!m) return;
    streamingRef.current = streaming;
    // The AI reply owns the state while it streams (mic callback skips). Reset the
    // mic's last-known state on every transition so that when streaming ends the
    // mic callback sees a genuine change and re-applies talk intensity from the
    // current volume (otherwise a stale micStateRef leaves the mask stuck idle).
    micStateRef.current = "idle";
    if (streaming) {
      setState("talk");
      m.triggerState("talk");
    } else {
      setState("idle");
      m.triggerState("idle");
    }
  }, [streaming]);

  // Keep the chat log pinned to the newest message.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const runBanner = () => {
    // Typing a message + RUN also turns the banner on so it's visible.
    maskRef.current?.setBanner(banner);
    maskRef.current?.setBannerEnabled(true);
    setBannerOn(true);
  };
  const toggleBanner = () => {
    const next = !bannerOn;
    maskRef.current?.setBannerEnabled(next);
    setBannerOn(next);
  };
  const applyFace = (f: FaceType) => {
    setFace(f);
    maskRef.current?.setFace(f);
  };
  const applyShell = (id: ShellId) => {
    setShell(id);
    maskRef.current?.setShell(id);
  };
  const applyState = (s: MaskState) => {
    setState(s);
    maskRef.current?.triggerState(s);
  };
  // Route through applyState→triggerState so prior-state timers/pose reset first.
  const castSpell = () => applyState("cast");
  const takeHit = () => {
    maskRef.current?.takeDamage(0.18);
    setHealth(maskRef.current?.getHealth() ?? 1);
  };
  const repair = () => {
    maskRef.current?.repair();
    setHealth(1);
  };
  const applyHealth = (h: number) => {
    setHealth(h);
    maskRef.current?.setHealth(h);
  };

  // Eyes follow the cursor over the stage; release back to idle drift on leave.
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    maskRef.current?.setGazeTarget(nx, ny);
  };
  const onPointerLeave = () => maskRef.current?.clearGazeTarget();

  const submitChat = () => {
    const text = draft.trim();
    if (!text || streaming || !ready) return;
    // Reset mood so the next reply re-ignites the face; show a "thinking" face.
    lastMoodRef.current = "";
    setFace("scan");
    maskRef.current?.setFace("scan");
    send(text);
    setDraft("");
  };

  // --- Active Mode controls ------------------------------------------------
  // Tear down every live capture when the studio unmounts.
  useEffect(() => {
    return () => {
      faceRef.current?.stop();
      micRef.current?.stop();
      capRef.current?.stop();
    };
  }, []);

  const toggleCamera = async () => {
    const m = maskRef.current;
    if (camLoading) return;
    if (camOn) {
      faceRef.current?.stop();
      faceRef.current = null;
      m?.setLiveEyes(null);
      m?.clearGazeTarget();
      liveFaceRef.current = null;
      if (previewRef.current) previewRef.current.replaceChildren();
      setCamOn(false);
      return;
    }
    setActiveErr("");
    setCamLoading(true);
    const ft = new FaceTracker();
    faceRef.current = ft;
    const ok = await ft.start(
      (sig) => {
        const mm = maskRef.current;
        if (!mm) return;
        // Mirror the user's expression — only re-ignite on a genuine change.
        if (sig.expression !== liveFaceRef.current) {
          liveFaceRef.current = sig.expression;
          setFace(sig.expression);
          mm.setFace(sig.expression);
        }
        mm.setLiveEyes(sig.eyeOpen);
        mm.setGazeTarget(sig.gazeX, -sig.gazeY);
      },
      undefined,
      (err) => setActiveErr(describeMediaError(err, "Camera")),
    );
    setCamLoading(false);
    if (ok) {
      setCamOn(true);
      const vid = ft.getVideoElement();
      if (vid && previewRef.current) {
        vid.className = "ledmask-active-preview-video";
        previewRef.current.replaceChildren(vid);
      }
    } else {
      faceRef.current = null;
    }
  };

  const toggleMic = async () => {
    const m = maskRef.current;
    if (micOn) {
      micRef.current?.stop();
      micRef.current = null;
      m?.setLiveMouth(null);
      micStateRef.current = "idle";
      setMicOn(false);
      return;
    }
    if (micLoading) return;
    setActiveErr("");
    setMicLoading(true);
    const mic = new MicLipSync();
    micRef.current = mic;
    const ok = await mic.start(
      (lvl) => {
        const mm = maskRef.current;
        if (!mm) return;
        mm.setLiveMouth(lvl);
        // Volume drives talk INTENSITY (whisper → talk → shout), never anger:
        // a louder voice reads as a bigger delivery, not a mood. Skip while the
        // AI is mid-reply so its own talk state wins.
        if (streamingRef.current) return;
        const st: MaskState = lvl > 0.5 ? "shout" : lvl > 0.22 ? "talk" : lvl > 0.06 ? "whisper" : "idle";
        if (st !== micStateRef.current) {
          micStateRef.current = st;
          setState(st);
          mm.triggerState(st);
        }
      },
      (err) => setActiveErr(describeMediaError(err, "Microphone")),
    );
    setMicLoading(false);
    if (ok) setMicOn(true);
    else micRef.current = null;
  };

  const toggleCaptions = () => {
    if (ccOn) {
      capRef.current?.stop();
      capRef.current = null;
      setLiveCaption("");
      setCcOn(false);
      return;
    }
    if (!captionsSupported) {
      setActiveErr("Live captions need the Web Speech API (Chrome or Edge). This browser doesn't expose it.");
      return;
    }
    setActiveErr("");
    const cap = new Captioner();
    capRef.current = cap;
    const ok = cap.start(
      (text, isFinal) => {
        setLiveCaption(text);
        // Only commit finished phrases to the banner so the ticker doesn't
        // keep restarting from the right edge on every interim word.
        if (isFinal) maskRef.current?.setBanner(text);
      },
      (err) => setActiveErr(`Captions error: ${err}`),
    );
    if (ok) {
      setCcOn(true);
      // Captions need the ticker to be visible, so enabling them switches the
      // banner on. The user can still turn it back off; we never force it on
      // again afterward.
      maskRef.current?.setBannerEnabled(true);
      setBannerOn(true);
    } else capRef.current = null;
  };

  return (
    <div className="ledmask">
      {/* Slow-rolling backdrop of all room posters. Purely decorative
          (aria-hidden, pointer-events none); veiled so the UI stays readable
          and paused entirely under prefers-reduced-motion. */}
      <div className="ledmask-bg" aria-hidden="true">
        <div className="ledmask-bg-track">
          {[0, 1, 2].flatMap((rep) =>
            MASK_ROOMS.map((room) => (
              <img key={`${rep}-${room.id}`} src={room.poster} alt="" draggable={false} />
            )),
          )}
        </div>
        <div className="ledmask-bg-veil" />
      </div>

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
          <button
            className="ledmask-exit ledmask-frame-btn"
            onClick={() => setFrameModal(true)}
            title="Choose a stage frame"
          >
            <LayoutPanelTop size={16} /> Frame
          </button>
          <button className="ledmask-exit" onClick={onExit}>
            <DoorOpen size={16} /> Doors
          </button>
        </div>
      </div>

      <div className="ledmask-grid">
        <div className="ledmask-stage">
          <div
            className={"ledmask-canvas-wrap" + (frame ? " has-frame" : "")}
            style={stageFrameStyle}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
          >
            <canvas ref={canvasRef} className="ledmask-canvas" />
            {webglFailed && (
              <div className="ledmask-fallback">
                WebGL unavailable in this view — open in a browser tab to see the mask render.
              </div>
            )}
          </div>
        </div>

        <div className="ledmask-controls">
          <section className="ledmask-panel">
            <div className="ledmask-panel-title">🤖 TALK TO THE MASK</div>
            <div className="ledmask-chat">
              <div className="ledmask-chat-log" ref={logRef}>
                {messages.length === 0 && (
                  <div className="ledmask-chat-empty">
                    Say something — the mask answers, shows how it feels on its face,
                    and follows your cursor with its eyes.
                  </div>
                )}
                {messages.map((m, i) => {
                  const text = m.role === "assistant" ? parseMood(m.content).clean : m.content;
                  const pending = m.role === "assistant" && !text;
                  return (
                    <div key={i} className={`ledmask-msg ${m.role}`}>
                      {pending ? (
                        <div className="ledmask-bubble">
                          <span className="ledmask-typing">
                            <span />
                            <span />
                            <span />
                          </span>
                        </div>
                      ) : (
                        <div className="ledmask-bubble">{text}</div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="ledmask-chat-row">
                <textarea
                  className="ledmask-chat-input"
                  rows={1}
                  value={draft}
                  placeholder={ready ? "Ask the mask anything…" : "Connecting…"}
                  disabled={!ready}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submitChat();
                    }
                  }}
                />
                <button
                  className="ledmask-run"
                  onClick={submitChat}
                  disabled={!ready || streaming || !draft.trim()}
                  title="Send"
                >
                  <Send size={15} />
                </button>
              </div>
              <button
                className="ledmask-chat-clear"
                onClick={() => {
                  clear();
                  lastMoodRef.current = "";
                }}
                disabled={messages.length === 0 || streaming}
              >
                <Trash2 size={12} /> Clear conversation
              </button>
            </div>
          </section>

          <section className="ledmask-panel">
            <div className="ledmask-panel-title">🎥 ACTIVE MODE — MIRROR YOUR FACE</div>
            <p className="ledmask-hint" style={{ margin: "0 0 10px" }}>
              Camera mirrors your real expression onto the mask · mic lip-syncs the
              mouth to your voice · speech is captioned onto the banner.
            </p>
            <div className="ledmask-active-row">
              <button
                className={"ledmask-state" + (camOn ? " is-active" : "")}
                onClick={toggleCamera}
                disabled={!mediaSupported || camLoading}
              >
                {camLoading ? "STARTING…" : camOn ? "■ CAMERA" : "▶ CAMERA"}
              </button>
              <button
                className={"ledmask-state" + (micOn ? " is-active" : "")}
                onClick={toggleMic}
                disabled={!mediaSupported || micLoading}
              >
                {micLoading ? "STARTING…" : micOn ? "■ MIC" : "▶ MIC"}
              </button>
              <button
                className={"ledmask-state" + (ccOn ? " is-active" : "")}
                onClick={toggleCaptions}
                disabled={!captionsSupported}
                title={captionsSupported ? "" : "Needs Chrome or Edge"}
              >
                {ccOn ? "■ CAPTIONS" : "▶ CAPTIONS"}
              </button>
            </div>
            {camOn && (
              <p className="ledmask-active-live">
                ● Live — the AI is reading your expression. The camera feed itself is never shown.
              </p>
            )}
            {/* Invisible 1px holder: keeps the camera <video> decoding for the face
                model without ever showing the raw feed. */}
            <div ref={previewRef} className="ledmask-active-preview" aria-hidden="true" />
            {ccOn && (
              <div className="ledmask-active-cc">{liveCaption || "Listening…"}</div>
            )}
            {camLoading && <p className="ledmask-hint">Loading face model (first use only)…</p>}
            {!mediaSupported && (
              <p className="ledmask-active-err">Camera/mic capture isn't available in this browser.</p>
            )}
            {activeErr && <p className="ledmask-active-err">{activeErr}</p>}
          </section>

          <section className="ledmask-panel">
            <div className="ledmask-panel-title">📜 SCROLLING BANNER</div>
            <div className="ledmask-banner-row" style={{ marginBottom: 8, alignItems: "center" }}>
              <button
                className={"ledmask-state" + (bannerOn ? " is-active" : "")}
                onClick={toggleBanner}
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") runBanner();
                }}
                placeholder="Type a message…"
              />
              <button className="ledmask-run" onClick={runBanner}>
                RUN
              </button>
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
                  onClick={() => applyShell(s.id)}
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
                  onClick={() => applyFace(f.id)}
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
                  onClick={() => applyState(s.id)}
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
              <button className="ledmask-state" onClick={castSpell}>
                CAST SPELL
              </button>
              <button className="ledmask-state is-danger" onClick={takeHit}>
                TAKE HIT
              </button>
              <button className="ledmask-state" onClick={repair}>
                REPAIR
              </button>
            </div>
            <div className="ledmask-banner-row" style={{ marginTop: 10, alignItems: "center" }}>
              <span className="ledmask-face-label" style={{ minWidth: 64 }}>
                HEALTH {Math.round(health * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(health * 100)}
                onChange={(e) => applyHealth(Number(e.target.value) / 100)}
                style={{ flex: 1 }}
              />
            </div>
            <p className="ledmask-hint">Shortcuts: C cast · H hit · R repair</p>
          </section>
        </div>
      </div>

      <FrameSkinModal
        open={frameModal}
        current={frameId}
        onPick={pickFrame}
        onClose={() => setFrameModal(false)}
      />
    </div>
  );
}
