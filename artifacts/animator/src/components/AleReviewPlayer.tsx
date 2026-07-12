import { useCallback, useEffect, useRef, useState } from "react";
import type { AleCameraMode, AleReview } from "../three/types";

interface Props {
  review: AleReview | null;
  /** Cut the live duel camera as each beat plays, so you watch the moment A.L.E. calls. */
  onCamera?: (mode: AleCameraMode) => void;
  /** Camera mode to restore once the reel finishes (so playback doesn't strand the view). */
  currentCamera?: AleCameraMode;
}

const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * Plays A.L.E.'s ~10s narrated highlight reel: speaks each beat aloud with the
 * browser's built-in voice (no external service / credentials), shows synced
 * captions + a progress bar, and cuts the duel camera to each beat's angle.
 */
export function AleReviewPlayer({ review, onCamera, currentCamera }: Props) {
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(-1);
  const [progress, setProgress] = useState(0);
  const timers = useRef<number[]>([]);
  const raf = useRef<number | null>(null);
  /** Camera to restore when the reel ends; null unless a reel is mid-play. */
  const restore = useRef<AleCameraMode | null>(null);

  const cleanup = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (canSpeak) window.speechSynthesis.cancel();
  }, []);

  const stop = useCallback(() => {
    cleanup();
    // Return the live view to wherever it was before the reel took over.
    if (restore.current) {
      onCamera?.(restore.current);
      restore.current = null;
    }
    setPlaying(false);
    setIdx(-1);
    setProgress(0);
  }, [cleanup, onCamera]);

  // Tear down timers/speech on unmount, and reset if the reel changes underneath us.
  useEffect(() => () => cleanup(), [cleanup]);
  useEffect(() => {
    stop();
  }, [review, stop]);

  const speak = useCallback((text: string) => {
    if (!canSpeak || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.08;
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  }, []);

  const play = useCallback(() => {
    if (!review || review.beats.length === 0) return;
    cleanup();
    restore.current = currentCamera ?? null;
    setPlaying(true);
    setIdx(0);
    setProgress(0);
    const start = performance.now();

    review.beats.forEach((b, i) => {
      const id = window.setTimeout(() => {
        setIdx(i);
        onCamera?.(b.camera);
        speak(b.speak);
      }, b.atMs);
      timers.current.push(id);
    });
    timers.current.push(window.setTimeout(() => stop(), review.totalMs));

    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / review.totalMs);
      setProgress(p);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [review, cleanup, currentCamera, onCamera, speak, stop]);

  if (!review || review.beats.length === 0) return null;
  const current = idx >= 0 ? review.beats[idx] : null;
  const secs = Math.round(review.totalMs / 1000);

  return (
    <div className="ale-review">
      <div className="ale-row-label">
        Narrated Review <span className="ale-review-len">{secs}s</span>
      </div>
      <div className={`ale-review-stage ${playing ? "live" : ""}`}>
        <div className="ale-review-caption">{current ? current.caption : "A.L.E. highlight reel"}</div>
        <div className="ale-review-bar">
          <div className="ale-review-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <button className="opt ale-review-btn" onClick={playing ? stop : play}>
        {playing ? "Stop" : "Play narrated review"}
      </button>
      {!canSpeak && (
        <div className="ale-review-note">Voice narration unavailable in this browser — captions only.</div>
      )}
    </div>
  );
}
