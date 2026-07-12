import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FaceType } from "../LedMask";

/**
 * FaceTracker — mirrors the user's real face onto the LED mask.
 *
 * Wraps MediaPipe's FaceLandmarker (running in VIDEO mode with ARKit-style
 * blendshape output) over a getUserMedia webcam stream. Each frame it reads the
 * 52 blendshape coefficients, classifies them into the mask's nearest
 * {@link FaceType} expression, and derives a continuous eye-open amount + a gaze
 * direction. Mouth motion is intentionally NOT emitted here — the mic drives the
 * mouth (lip-sync) so the face "speaks the words" the user says.
 *
 * Self-contained: owns its hidden <video>, the rAF detect loop, the WASM fileset,
 * and the model. The model + WASM are fetched from the pinned MediaPipe CDN on
 * first start; everything is released on stop().
 */

const TASKS_VISION_VERSION = "0.10.35";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export interface FaceSignal {
  /** Nearest mask expression to the user's current face. */
  expression: FaceType;
  /** Eye openness 0 (shut) .. 1 (wide). */
  eyeOpen: number;
  /** Horizontal gaze, -1 (face's left) .. 1 (face's right), already mirrored. */
  gazeX: number;
  /** Vertical gaze, -1 (down) .. 1 (up). */
  gazeY: number;
}

export type FaceTrackerStatus = "idle" | "loading" | "running" | "error";

type BlendMap = Record<string, number>;

export class FaceTracker {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private landmarker: FaceLandmarker | null = null;
  private raf = 0;
  private active = false;
  private startGen = 0; // bumped by stop()/each start() to cancel stale async starts
  private lastVideoTime = -1;
  // Debounce: only switch expression once a new one holds briefly, so the face
  // doesn't strobe between near-ties. setFace() on the mask is an expensive
  // dissolve sweep, so we report a stable expression rather than per-frame noise.
  private candidate: FaceType = "neutral";
  private candidateHold = 0;
  private committed: FaceType = "neutral";

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  /**
   * Acquire the webcam, load the model, and begin emitting a {@link FaceSignal}
   * each frame. `onStatus` reports lifecycle ("loading" while the model downloads);
   * `onError` fires if the camera is blocked (common inside the proxied preview
   * iframe) or the model fails to load.
   */
  async start(
    onSignal: (s: FaceSignal) => void,
    onStatus?: (s: FaceTrackerStatus) => void,
    onError?: (err: unknown) => void,
  ): Promise<boolean> {
    if (this.active) return true;
    const gen = ++this.startGen;
    const stale = () => gen !== this.startGen;
    onStatus?.("loading");
    // Acquire into locals so a stop() racing our awaits can't leave half-built
    // state attached to `this` — we only commit once everything is ready AND
    // this start is still the current one.
    let stream: MediaStream | null = null;
    let landmarker: FaceLandmarker | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      if (stale()) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      const video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      if (stale()) {
        video.srcObject = null;
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }

      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      if (stale()) {
        video.srcObject = null;
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
        runningMode: "VIDEO",
        numFaces: 1,
      });
      if (stale()) {
        landmarker.close();
        video.srcObject = null;
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }

      // Commit — everything is ready and this start is still current.
      this.stream = stream;
      this.video = video;
      this.landmarker = landmarker;
      this.active = true;
      onStatus?.("running");

      const loop = () => {
        if (!this.active || !this.video || !this.landmarker) return;
        const v = this.video;
        if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
          this.lastVideoTime = v.currentTime;
          try {
            const res = this.landmarker.detectForVideo(v, performance.now());
            const shapes = res.faceBlendshapes?.[0]?.categories;
            if (shapes && shapes.length) {
              const map: BlendMap = {};
              for (const c of shapes) map[c.categoryName] = c.score;
              onSignal(this.deriveSignal(map));
            }
          } catch {
            /* a single dropped frame is fine; keep the loop alive */
          }
        }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
      return true;
    } catch (err) {
      landmarker?.close();
      stream?.getTracks().forEach((t) => t.stop());
      this.stop();
      onStatus?.("error");
      onError?.(err);
      return false;
    }
  }

  /** Hidden <video> element carrying the live camera, for an optional UI preview. */
  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  stop(): void {
    this.startGen++; // cancel any in-flight start()
    this.active = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastVideoTime = -1;
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        /* ignore */
      }
      this.landmarker = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  get running(): boolean {
    return this.active;
  }

  private get(map: BlendMap, name: string): number {
    return map[name] ?? 0;
  }

  /** Collapse the 52-channel blendshape vector into the mask's vocabulary. */
  private deriveSignal(map: BlendMap): FaceSignal {
    const smileL = this.get(map, "mouthSmileLeft");
    const smileR = this.get(map, "mouthSmileRight");
    const smile = (smileL + smileR) / 2;
    // A markedly one-sided smile reads as a sly smirk → mischief.
    const smirk = Math.abs(smileL - smileR);
    const frown = (this.get(map, "mouthFrownLeft") + this.get(map, "mouthFrownRight")) / 2;
    const browDown = (this.get(map, "browDownLeft") + this.get(map, "browDownRight")) / 2;
    const browUp = this.get(map, "browInnerUp");
    const jawOpen = this.get(map, "jawOpen");
    const eyeWide = (this.get(map, "eyeWideLeft") + this.get(map, "eyeWideRight")) / 2;
    const pucker = this.get(map, "mouthPucker");
    const blinkL = this.get(map, "eyeBlinkLeft");
    const blinkR = this.get(map, "eyeBlinkRight");
    const squint = (this.get(map, "eyeSquintLeft") + this.get(map, "eyeSquintRight")) / 2;

    const eyeOpen = Math.max(0, 1 - Math.max(blinkL, blinkR));

    // Gaze: combine the eye-look blendshapes. Mirror X so it reads like a mirror.
    const lookRight =
      (this.get(map, "eyeLookOutLeft") + this.get(map, "eyeLookInRight")) / 2;
    const lookLeft =
      (this.get(map, "eyeLookOutRight") + this.get(map, "eyeLookInLeft")) / 2;
    const lookUp = (this.get(map, "eyeLookUpLeft") + this.get(map, "eyeLookUpRight")) / 2;
    const lookDown = (this.get(map, "eyeLookDownLeft") + this.get(map, "eyeLookDownRight")) / 2;
    const gazeX = clamp((lookLeft - lookRight) * 2.2, -1, 1); // mirrored
    const gazeY = clamp((lookUp - lookDown) * 2.2, -1, 1);

    // Classify (priority order matters — strongest, most distinctive cues first).
    // Bias toward the everyday set (neutral / smile / mischief) and keep `angry`
    // RARE: it requires a hard brow furrow with a CLOSED mouth, so simply talking
    // or shouting (jaw open) never reads as anger — loudness is conveyed by the
    // mic driving talk intensity, not by the face classifier.
    let expr: FaceType = "neutral";
    const oneEyeClosed = Math.abs(blinkL - blinkR) > 0.5 && Math.max(blinkL, blinkR) > 0.5;
    if (oneEyeClosed && smile > 0.12) expr = "wink";
    else if (smirk > 0.18 && smile > 0.1) expr = "mischief";
    else if (eyeWide > 0.45 && jawOpen > 0.3) expr = "surprise";
    else if (pucker > 0.5 && smile > 0.2) expr = "love";
    else if (smile > 0.42) expr = "happy";
    else if (smile > 0.18) expr = "smile";
    else if (browDown > 0.55 && jawOpen < 0.2 && smile < 0.1) expr = "angry";
    else if (browUp > 0.4 || frown > 0.35) expr = "sad";
    else if (squint > 0.45) expr = "skeptical";
    else expr = "neutral";

    // Debounce expression to avoid strobing on near-ties (~6 frames to commit).
    if (expr === this.candidate) {
      this.candidateHold++;
    } else {
      this.candidate = expr;
      this.candidateHold = 0;
    }
    if (this.candidateHold >= 6 && this.candidate !== this.committed) {
      this.committed = this.candidate;
    }

    return { expression: this.committed, eyeOpen, gazeX, gazeY };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
