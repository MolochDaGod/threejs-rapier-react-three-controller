/**
 * Captioner — live speech-to-text for the LED mask's scrolling banner.
 *
 * Uses the browser's built-in Web Speech API (SpeechRecognition / the webkit
 * prefix), so there is no API key and no audio leaves the device's speech engine
 * boundary beyond what the browser already does. It streams interim results so
 * the banner updates as the user speaks, then commits final phrases. The API is
 * Chromium-centric; {@link Captioner.isSupported} lets the UI degrade gracefully.
 *
 * The DOM lib does not ship SpeechRecognition types, so a minimal structural
 * interface is declared locally rather than pulling in @types or using `any`.
 */
export type CaptionStatus = "idle" | "running" | "error";

interface SRAlternative {
  readonly transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  readonly [index: number]: SRResult;
}
interface SRRecognitionEvent {
  readonly resultIndex: number;
  readonly results: SRResultList;
}
interface SRErrorEvent {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SRRecognitionEvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class Captioner {
  private rec: SpeechRecognitionLike | null = null;
  private active = false;

  /** True if the browser exposes a Web Speech recognition engine. */
  static isSupported(): boolean {
    return getCtor() !== null;
  }

  /**
   * Start transcribing. `onText(text, isFinal)` fires with the latest interim
   * phrase as the user speaks and again (isFinal=true) when a phrase commits.
   * Recognition auto-restarts on its natural `onend` while still active so it
   * behaves like a continuous live caption track.
   */
  start(
    onText: (text: string, isFinal: boolean) => void,
    onError?: (err: string) => void,
    lang = "en-US",
  ): boolean {
    const Ctor = getCtor();
    if (!Ctor) {
      onError?.("unsupported");
      return false;
    }
    if (this.active) return true;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) final += text;
        else interim += text;
      }
      const phrase = (final || interim).trim();
      if (phrase) onText(phrase, !!final);
    };
    rec.onerror = (e) => {
      // "no-speech"/"aborted" are routine; surface the rest.
      if (e.error !== "no-speech" && e.error !== "aborted") onError?.(e.error);
    };
    rec.onend = () => {
      if (this.active) {
        try {
          rec.start();
        } catch {
          /* a restart can throw if called too eagerly; ignore */
        }
      }
    };
    this.rec = rec;
    this.active = true;
    try {
      rec.start();
      return true;
    } catch (err) {
      this.active = false;
      this.rec = null;
      onError?.(String(err));
      return false;
    }
  }

  stop(): void {
    this.active = false;
    if (this.rec) {
      this.rec.onend = null;
      this.rec.onresult = null;
      this.rec.onerror = null;
      try {
        this.rec.abort();
      } catch {
        /* ignore */
      }
      this.rec = null;
    }
  }

  get running(): boolean {
    return this.active;
  }
}
