import { useEffect, useRef, useState } from "react";
import { LedMask, type FaceType, type MaskState } from "./LedMask";
import type { ShellId } from "./LedMaskShells";

/**
 * Live WebGL stage shared by every ledmask-redesign mockup: mounts the REAL
 * LedMask engine (vendored verbatim from the Animator app) so the voxel mesh,
 * shell housings, LED textures, and colors are the true in-app render.
 * Fills its parent; the parent supplies the frame/border styling.
 */
export function LiveMaskStage({
  face,
  shell,
  maskState,
  bannerText,
  bannerOn,
  health,
  onAutoIdle,
}: {
  face: FaceType;
  shell: ShellId;
  maskState: MaskState;
  bannerText?: string;
  bannerOn?: boolean;
  /** Health percent, 0–100 (converted to the engine's 0–1 range internally). */
  health?: number;
  onAutoIdle?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<LedMask | null>(null);
  const [failed, setFailed] = useState(false);
  const idleCb = useRef(onAutoIdle);
  idleCb.current = onAutoIdle;

  useEffect(() => {
    if (!canvasRef.current) return;
    const m = new LedMask(canvasRef.current);
    maskRef.current = m;
    m.onAutoIdle = () => idleCb.current?.();
    setFailed(m.webglFailed);
    return () => {
      m.dispose();
      maskRef.current = null;
    };
  }, []);

  useEffect(() => { maskRef.current?.setFace(face); }, [face]);
  useEffect(() => { maskRef.current?.setShell(shell); }, [shell]);
  useEffect(() => { maskRef.current?.triggerState(maskState); }, [maskState]);
  useEffect(() => {
    if (bannerText !== undefined) maskRef.current?.setBanner(bannerText);
  }, [bannerText]);
  useEffect(() => {
    if (bannerOn !== undefined) maskRef.current?.setBannerEnabled(bannerOn);
  }, [bannerOn]);
  useEffect(() => {
    if (health !== undefined) maskRef.current?.setHealth(health / 100);
  }, [health]);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    maskRef.current?.setGazeTarget(nx, ny);
  };
  const onPointerLeave = () => maskRef.current?.clearGazeTarget();

  return (
    <div
      style={{ position: "absolute", inset: 0 }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      {failed && (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", textAlign: "center", padding: 24,
            color: "#8b93b5", fontSize: "0.9rem",
          }}
        >
          WebGL unavailable in this view — open in a browser tab to see the mask render.
        </div>
      )}
    </div>
  );
}

export default LiveMaskStage;
