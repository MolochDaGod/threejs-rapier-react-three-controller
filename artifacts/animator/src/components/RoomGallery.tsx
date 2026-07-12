import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useDevice } from "../hooks/useDevice";
import { MASK_ROOMS, type MaskRoom, type RoomTarget } from "./ledMaskRooms";

interface Props {
  onNavigate: (target: RoomTarget) => void;
}

/**
 * Room posters stacked left-to-right — the phone home surface shown after
 * login (wrapped in `.roomgal-home`). All six tall posters sit side by side
 * in a horizontally scrollable strip; clicking a poster enters that room via
 * the full-screen loading transition (the room's square scene becomes the
 * backdrop), then navigates.
 *
 * Touch best practices: touch devices pan the strip natively (momentum
 * scroll + snap — no custom drag code), while desktop gets nudge arrows and
 * ←/→ keys since a mouse can't easily pan horizontally.
 */
export function RoomGallery({ onNavigate }: Props) {
  const { touchUI } = useDevice();
  const [entering, setEntering] = useState<MaskRoom | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const enter = (room: MaskRoom) => {
    if (entering) return;
    setEntering(room);
    // The scene image doubles as the loading backdrop; hold it briefly so the
    // transition reads before the next surface mounts.
    timer.current = window.setTimeout(() => onNavigate(room.target), 900);
  };

  // Scroll the strip by roughly one poster. Desktop-only affordance — touch
  // devices swipe the strip directly.
  const nudge = (dir: number) => {
    const el = stripRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>(".roomstrip-card");
    const w = card ? card.offsetWidth + 10 : 180;
    el.scrollBy({ left: dir * w, behavior: "smooth" });
  };

  // ←/→ nudge the strip on desktop. Ignored while typing (mask chat, banner
  // input) so the home page stays keyboard-friendly without stealing keys.
  useEffect(() => {
    if (touchUI) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      nudge(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [touchUI]);

  return (
    <section className="roomgal">
      <div className="roomgal-head">
        <div>
          <div className="roomgal-title">ENTER A ROOM</div>
          <div className="roomgal-sub">
            {touchUI
              ? "Swipe through the rooms · tap a poster to enter."
              : "Scroll, use the arrows or ← → keys · click a poster to enter."}
          </div>
        </div>
      </div>

      <div className="roomstrip-wrap">
        <div className="roomstrip" ref={stripRef}>
          {MASK_ROOMS.map((room) => (
            <button
              key={room.id}
              type="button"
              className="roomstrip-card"
              style={{ ["--accent" as string]: room.accent }}
              onClick={() => enter(room)}
              disabled={!!entering}
              aria-label={`Enter ${room.label}`}
            >
              <img
                className="roomstrip-art"
                src={room.poster}
                alt={room.label}
                loading="lazy"
                draggable={false}
              />
              <div className="roomstrip-veil" />
              <div className="roomstrip-meta">
                <div className="roomstrip-name">{room.label}</div>
                <div className="roomstrip-tag">{room.tagline}</div>
                <span className="roomstrip-enter">
                  Enter <ArrowRight size={14} />
                </span>
              </div>
            </button>
          ))}
        </div>

        {!touchUI && (
          <>
            <button
              type="button"
              className="roomstrip-arrow is-left"
              onClick={() => nudge(-1)}
              disabled={!!entering}
              aria-label="Scroll rooms left"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="roomstrip-arrow is-right"
              onClick={() => nudge(1)}
              disabled={!!entering}
              aria-label="Scroll rooms right"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      <AnimatePresence>
        {entering && (
          <motion.div
            className="roomgal-loader"
            style={{ ["--accent" as string]: entering.accent }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <motion.div
              className="roomgal-loader-bg"
              style={{ backgroundImage: `url(${entering.scene})` }}
              initial={{ scale: 1.15, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 1.1, ease: "easeOut" }}
            />
            <div className="roomgal-loader-veil" />
            <motion.div
              className="roomgal-loader-card"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 280, damping: 26 }}
            >
              <div className="roomgal-loader-name">{entering.label}</div>
              <div className="roomgal-loader-status">ENTERING…</div>
              <div className="roomgal-loader-bar">
                <motion.span
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 0.85, ease: "easeInOut" }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
