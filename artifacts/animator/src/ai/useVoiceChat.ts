/**
 * "Talk to AI" voice in/out for the global companion dock.
 *
 * - Voice IN: reuses {@link Captioner} (the browser Web Speech API) to transcribe
 *   the user's speech into the chat input live; final phrases fire `onPhrase`.
 * - Voice OUT: speaks assistant replies via `speechSynthesis`.
 * - Captions: the live interim transcript is exposed so the UI can show it.
 *
 * Every capability is feature-gated and degrades silently where the browser
 * doesn't expose the API (e.g. SpeechRecognition is Chromium-only), so the dock
 * stays fully usable as text-only chat elsewhere.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Captioner } from "../three/live/Captioner";

function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export interface UseVoiceChatArgs {
  /** Master enable — when false the hook reports unsupported and does nothing. */
  enabled: boolean;
  /** Fires with each committed (final) spoken phrase, e.g. to send it. */
  onPhrase: (text: string) => void;
  /** Fires with the live interim transcript so the input can mirror speech. */
  onInterim?: (text: string) => void;
}

export interface UseVoiceChat {
  /** SpeechRecognition is available (voice input possible). */
  sttSupported: boolean;
  /** speechSynthesis is available (voice output possible). */
  ttsSupported: boolean;
  /** Currently transcribing the mic. */
  listening: boolean;
  /** Reply read-aloud is armed. */
  speakReplies: boolean;
  /** Currently speaking a reply. */
  speaking: boolean;
  /** Live interim caption text (empty when idle). */
  caption: string;
  /** Last STT error, if any (cleared when listening restarts). */
  error: string;
  toggleListen: () => void;
  stopListen: () => void;
  toggleSpeakReplies: () => void;
  /** Speak a reply now (no-op unless speakReplies is on + TTS supported). */
  speak: (text: string) => void;
  /** Cancel any in-flight speech. */
  cancelSpeak: () => void;
}

export function useVoiceChat({ enabled, onPhrase, onInterim }: UseVoiceChatArgs): UseVoiceChat {
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");

  const capRef = useRef<Captioner | null>(null);
  const onPhraseRef = useRef(onPhrase);
  onPhraseRef.current = onPhrase;
  const onInterimRef = useRef(onInterim);
  onInterimRef.current = onInterim;

  const sttSupported = enabled && Captioner.isSupported();
  const tts = enabled && ttsSupported();

  const stopListen = useCallback(() => {
    capRef.current?.stop();
    capRef.current = null;
    setCaption("");
    setListening(false);
  }, []);

  const toggleListen = useCallback(() => {
    if (capRef.current) {
      stopListen();
      return;
    }
    if (!Captioner.isSupported()) {
      setError("Voice input needs the Web Speech API (Chrome or Edge).");
      return;
    }
    setError("");
    const cap = new Captioner();
    capRef.current = cap;
    const ok = cap.start(
      (text, isFinal) => {
        setCaption(text);
        onInterimRef.current?.(text);
        if (isFinal) {
          onPhraseRef.current(text);
          setCaption("");
        }
      },
      (err) => setError(err === "unsupported" ? "Voice input isn't available here." : `Voice error: ${err}`),
    );
    if (ok) setListening(true);
    else capRef.current = null;
  }, [stopListen]);

  const cancelSpeak = useCallback(() => {
    if (ttsSupported()) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!tts) return;
      const clean = text.trim();
      if (!clean) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(clean);
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utter);
    },
    [tts],
  );

  const toggleSpeakReplies = useCallback(() => {
    setSpeakReplies((on) => {
      const next = !on;
      if (!next) cancelSpeak();
      return next;
    });
  }, [cancelSpeak]);

  // Tear everything down on unmount.
  useEffect(() => {
    return () => {
      capRef.current?.stop();
      capRef.current = null;
      if (ttsSupported()) window.speechSynthesis.cancel();
    };
  }, []);

  return {
    sttSupported,
    ttsSupported: tts,
    listening,
    speakReplies,
    speaking,
    caption,
    error,
    toggleListen,
    stopListen,
    toggleSpeakReplies,
    speak,
    cancelSpeak,
  };
}
