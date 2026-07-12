import { useEffect, useRef } from "react";

/** Engine touch hooks the controls drive (a thin slice of Studio). */
export interface TouchApi {
  touchMoveInput(x: number, y: number): void;
  touchLook(dx: number, dy: number): void;
  touchLookEnd(): void;
  setTouchSprint(on: boolean): void;
  touchJump(): void;
  touchAttack(): void;
  touchSkill(index?: number): void;
  touchSkyfall(): void;
}

/** Radius (px) the joystick thumb travels before clamping to full tilt. */
const STICK_RADIUS = 52;

/**
 * On-screen controls for touch devices: a left analog joystick (move), a
 * right-half look pad (drag to aim), and a column of action buttons. Multitouch
 * is tracked per `pointerId` so the stick, look pad and buttons work at once.
 * Pure pointer events (no external joystick lib) — the artifact vendors its own
 * UI and forbids @workspace imports.
 */
export function TouchControls({ api }: { api: TouchApi }) {
  const stickBase = useRef<HTMLDivElement>(null);
  const stickThumb = useRef<HTMLDivElement>(null);
  // Active pointer ids: joystick + look drag (each at most one finger).
  const stickId = useRef<number | null>(null);
  const stickOrigin = useRef({ x: 0, y: 0 });
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });

  // Continuous look needs the latest api without re-binding listeners.
  const apiRef = useRef(api);
  apiRef.current = api;

  function setThumb(dx: number, dy: number) {
    const t = stickThumb.current;
    if (t) t.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  const onStickDown = (e: React.PointerEvent) => {
    if (stickId.current !== null) return;
    stickId.current = e.pointerId;
    const r = stickBase.current!.getBoundingClientRect();
    stickOrigin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onStickMove = (e: React.PointerEvent) => {
    if (e.pointerId !== stickId.current) return;
    let dx = e.clientX - stickOrigin.current.x;
    let dy = e.clientY - stickOrigin.current.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    setThumb(dx, dy);
    // y up on screen = forward, so invert dy.
    apiRef.current.touchMoveInput(dx / STICK_RADIUS, -dy / STICK_RADIUS);
  };
  const onStickUp = (e: React.PointerEvent) => {
    if (e.pointerId !== stickId.current) return;
    stickId.current = null;
    setThumb(0, 0);
    apiRef.current.touchMoveInput(0, 0);
  };

  const onLookDown = (e: React.PointerEvent) => {
    if (lookId.current !== null) return;
    lookId.current = e.pointerId;
    lookLast.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onLookMove = (e: React.PointerEvent) => {
    if (e.pointerId !== lookId.current) return;
    const dx = e.clientX - lookLast.current.x;
    const dy = e.clientY - lookLast.current.y;
    lookLast.current = { x: e.clientX, y: e.clientY };
    apiRef.current.touchLook(dx, dy);
  };
  const onLookUp = (e: React.PointerEvent) => {
    if (e.pointerId !== lookId.current) return;
    lookId.current = null;
    apiRef.current.touchLookEnd();
  };

  // If the controls unmount mid-touch (e.g. a panel opens before pointer-up
  // fires), the pointer handlers never run — so clear ALL latched virtual input
  // here, or movement/look would stay stuck in the engine.
  useEffect(
    () => () => {
      const a = apiRef.current;
      a.touchMoveInput(0, 0);
      a.touchLookEnd();
      a.setTouchSprint(false);
    },
    [],
  );

  return (
    <div className="touch-layer">
      {/* Right-half look pad sits behind the buttons. */}
      <div
        className="touch-lookpad"
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
      />

      <div
        className="touch-stick"
        ref={stickBase}
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
      >
        <div className="touch-stick-thumb" ref={stickThumb} />
      </div>

      <button
        className="touch-btn touch-sprint"
        onPointerDown={(e) => {
          e.preventDefault();
          api.setTouchSprint(true);
        }}
        onPointerUp={() => api.setTouchSprint(false)}
        onPointerCancel={() => api.setTouchSprint(false)}
      >
        RUN
      </button>

      <div className="touch-actions">
        <button
          className="touch-btn touch-attack"
          onPointerDown={(e) => {
            e.preventDefault();
            api.touchAttack();
          }}
        >
          ATK
        </button>
        <button
          className="touch-btn touch-jump"
          onPointerDown={(e) => {
            e.preventDefault();
            api.touchJump();
          }}
        >
          JMP
        </button>
        <button
          className="touch-btn touch-skill"
          onPointerDown={(e) => {
            e.preventDefault();
            api.touchSkill();
          }}
        >
          SKL
        </button>
        <button
          className="touch-btn touch-sky"
          onPointerDown={(e) => {
            e.preventDefault();
            api.touchSkyfall();
          }}
        >
          SKY
        </button>
      </div>
    </div>
  );
}
