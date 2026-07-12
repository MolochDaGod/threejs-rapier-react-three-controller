/**
 * MicLipSync — turns the user's live microphone level into a 0..1 "mouth open"
 * amount so the LED mask can lip-sync to whatever they say.
 *
 * Pure Web Audio: a getUserMedia audio stream feeds an AnalyserNode; each frame
 * we read the time-domain waveform, compute its RMS, gate out background hiss,
 * and smooth the result so the mouth tracks speech cadence without chattering.
 * No speech model is needed — this is amplitude only (the words themselves are
 * transcribed separately by {@link Captioner}).
 */
export type MicStatus = "idle" | "running" | "error";

export class MicLipSync {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private raf = 0;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private level = 0;
  private active = false;
  private startGen = 0; // bumped by stop()/each start() to cancel stale async starts

  /** True if mic capture is even possible in this browser/context. */
  static isSupported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  /**
   * Begin capturing the mic and reporting a smoothed mouth-open level (0..1)
   * every animation frame. Rejects (via onError) if permission is denied or the
   * browser blocks capture (e.g. an iframe without mic permission).
   */
  async start(
    onLevel: (level: number) => void,
    onError?: (err: unknown) => void,
  ): Promise<boolean> {
    if (this.active) return true;
    const gen = ++this.startGen;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // A stop() that raced our await invalidated this start — bail and release.
      if (gen !== this.startGen) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      this.stream = stream;
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) throw new Error("Web Audio not supported");
      this.ctx = new Ctx();
      // Some browsers start the context suspended until a gesture; resume best-effort.
      if (this.ctx.state === "suspended") void this.ctx.resume();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.source.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      this.active = true;

      const tick = () => {
        if (!this.active || !this.analyser || !this.buf) return;
        this.analyser.getFloatTimeDomainData(this.buf);
        let sum = 0;
        for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
        const rms = Math.sqrt(sum / this.buf.length);
        // Map a useful speech range to 0..1 with a noise gate, then expand.
        const gated = Math.max(0, rms - 0.012);
        const target = Math.min(1, gated * 14);
        // Fast attack, slower release so syllables read crisply but don't flap shut.
        const k = target > this.level ? 0.6 : 0.2;
        this.level += (target - this.level) * k;
        onLevel(this.level);
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
      return true;
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      this.stop();
      onError?.(err);
      return false;
    }
  }

  stop(): void {
    this.startGen++; // cancel any in-flight start()
    this.active = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      this.source?.disconnect();
    } catch {
      /* already gone */
    }
    this.source = null;
    this.analyser = null;
    this.buf = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.level = 0;
  }

  get running(): boolean {
    return this.active;
  }
}
