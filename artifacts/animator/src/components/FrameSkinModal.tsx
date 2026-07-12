import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { MASK_FRAMES, FRAME_NONE } from "./ledMaskFrames";

interface Props {
  open: boolean;
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
}

/**
 * Animated picker for the 16 sci-fi stage frames (plus a "no frame" option).
 * The grid is built from {@link MASK_FRAMES}; each swatch previews the tile as
 * a real 9-slice border so what you see is what wraps the stage.
 */
export function FrameSkinModal({ open, current, onPick, onClose }: Props) {
  // Esc closes the picker while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Picking a frame applies it and closes — the backdrop blurs out the live
  // stage anyway, so there's nothing to preview behind the modal.
  const choose = (id: string) => {
    onPick(id);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="framemodal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className="framemodal"
            role="dialog"
            aria-modal="true"
            aria-label="Stage frame picker"
            initial={{ opacity: 0, scale: 0.94, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="framemodal-head">
              <div>
                <div className="framemodal-title">STAGE FRAME</div>
                <div className="framemodal-sub">
                  Pick a bezel for the mask screen — your choice is saved.
                </div>
              </div>
              <button className="framemodal-x" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="framemodal-grid">
              <motion.button
                className={"framemodal-cell is-none" + (current === FRAME_NONE ? " is-active" : "")}
                onClick={() => choose(FRAME_NONE)}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.96 }}
              >
                <span className="framemodal-none-glyph">∅</span>
                <span className="framemodal-cell-label">None</span>
                {current === FRAME_NONE && (
                  <span className="framemodal-check">
                    <Check size={13} />
                  </span>
                )}
              </motion.button>

              {MASK_FRAMES.map((f, i) => (
                <motion.button
                  key={f.id}
                  className={"framemodal-cell" + (current === f.id ? " is-active" : "")}
                  onClick={() => choose(f.id)}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.02 * i, duration: 0.18 }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.96 }}
                >
                  <span
                    className="framemodal-swatch"
                    style={{
                      borderImage: `url(${f.src}) ${f.slice} fill / 18px / 0 stretch`,
                    }}
                  />
                  <span className="framemodal-cell-label">{f.label}</span>
                  {current === f.id && (
                    <span className="framemodal-check">
                      <Check size={13} />
                    </span>
                  )}
                </motion.button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
