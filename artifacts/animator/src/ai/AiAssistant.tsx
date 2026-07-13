/**
 * Reusable floating AI assistant dock. Anchored bottom-right, collapsible, and
 * surface-agnostic: callers pass a tool registry plus a system-prompt provider
 * that embeds fresh scene context each turn. Both the Scene Editor and the
 * Danger Room mount this same component with their own tools.
 *
 * "Talk to AI" voice is opt-in via the `voice` prop (default on): the mic
 * transcribes speech into the chat (and auto-sends committed phrases) and the
 * speaker reads replies aloud. Both capabilities degrade silently where the
 * browser lacks the Web Speech / speechSynthesis APIs.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Mic, MicOff, Send, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { useAssistant } from "./useAssistant";
import { useVoiceChat } from "./useVoiceChat";
import type { AiTool } from "./types";
import "./aiAssistant.css";

interface Props {
  /** Stable surface id (scopes the persisted conversation). */
  surface: string;
  /** Header title. */
  title: string;
  /** Live tool registry bound to the engine. */
  tools: AiTool[];
  /** Returns the full system prompt (with fresh scene context) per turn. */
  getSystemPrompt: () => string;
  /** One-line placeholder hinting at what the assistant can do. */
  placeholder?: string;
  /** Enable "Talk to AI" voice in/out + captions (default true). */
  voice?: boolean;
}

export function AiAssistant({ surface, title, tools, getSystemPrompt, placeholder, voice = true }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const { messages, streaming, ready, send, clear } = useAssistant({
    surface,
    tools,
    getSystemPrompt,
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const submit = (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || streaming || !ready) return;
    send(text);
    setDraft("");
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const vc = useVoiceChat({
    enabled: voice,
    onPhrase: (text) => submitRef.current(text),
    onInterim: (text) => setDraft(text),
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  // Read the newest assistant reply aloud once it finishes streaming.
  const spokenRef = useRef(0);
  useEffect(() => {
    if (!vc.speakReplies || streaming) return;
    if (messages.length <= spokenRef.current) return;
    const last = messages[messages.length - 1];
    spokenRef.current = messages.length;
    if (last?.role === "assistant" && last.content) vc.speak(last.content);
  }, [messages, streaming, vc]);

  // Stop the mic when the panel closes so it isn't listening invisibly.
  useEffect(() => {
    if (!open && vc.listening) vc.stopListen();
  }, [open, vc]);

  const showVoice = vc.sttSupported || vc.ttsSupported;
  const isEditorSurface = surface === "editor";

  return (
    <div className={`ai-assistant ${isEditorSurface ? "ai-assistant-editor-workbench" : ""}`}>
      <AnimatePresence>
        {open && (
          <motion.div
            className="ai-panel"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <div className="ai-head">
              <div className="ai-title">
                <Bot size={15} />
                <span>{title}</span>
              </div>
              <div className="ai-head-actions">
                {showVoice && vc.ttsSupported && (
                  <button
                    className={`ai-icon-btn ${vc.speakReplies ? "on" : ""}`}
                    title={vc.speakReplies ? "Mute spoken replies" : "Read replies aloud"}
                    onClick={vc.toggleSpeakReplies}
                  >
                    {vc.speakReplies ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  </button>
                )}
                <button
                  className="ai-icon-btn"
                  title="Clear conversation"
                  onClick={clear}
                  disabled={messages.length === 0 || streaming}
                >
                  <Trash2 size={14} />
                </button>
                <button className="ai-icon-btn" title="Close" onClick={() => setOpen(false)}>
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="ai-log" ref={scrollRef}>
              {messages.length === 0 && (
                <div className="ai-empty">
                  <Bot size={22} />
                  <p>
                    {isEditorSurface
                      ? "Describe a movement, weapon skill, or clip you want. I can help pick clips, tune Skill Lab, preview, and bind it to weapon slots."
                      : "Ask a question, or tell me what to change in the scene."}
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`ai-msg ai-${m.role}`}>
                  {m.content && <div className="ai-bubble">{m.content}</div>}
                  {m.tools && m.tools.length > 0 && (
                    <div className="ai-chips">
                      {m.tools.map((t, j) => (
                        <span key={j} className={`ai-chip ${t.ok ? "ok" : "bad"}`}>
                          {t.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.role === "assistant" && !m.content && (!m.tools || m.tools.length === 0) && (
                    <div className="ai-bubble ai-typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {vc.listening && (
              <div className="ai-caption" role="status" aria-live="polite">
                <span className="ai-caption-dot" />
                {vc.caption || "Listening…"}
              </div>
            )}
            {vc.error && <div className="ai-voice-error">{vc.error}</div>}

            <div className="ai-input">
              {showVoice && vc.sttSupported && (
                <button
                  className={`ai-voice-btn ${vc.listening ? "on" : ""}`}
                  onClick={vc.toggleListen}
                  disabled={!ready || streaming}
                  title={vc.listening ? "Stop talking" : "Talk to AI"}
                >
                  {vc.listening ? <MicOff size={15} /> : <Mic size={15} />}
                </button>
              )}
              <textarea
                rows={1}
                value={draft}
                placeholder={placeholder ?? "Type a command or question…"}
                disabled={!ready}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <button
                className="ai-send"
                onClick={() => submit()}
                disabled={!ready || streaming || !draft.trim()}
                title="Send"
              >
                <Send size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        className={`ai-fab ${open ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.92 }}
        title={title}
      >
        {open ? <X size={20} /> : <Bot size={20} />}
      </motion.button>
    </div>
  );
}
