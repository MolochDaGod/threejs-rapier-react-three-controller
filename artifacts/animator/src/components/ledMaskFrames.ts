// The 16 sci-fi panel frames, sliced from a single 4x4 reference sheet into
// `public/frames/frame-00.png … frame-15.png`. Each is used as a 9-slice
// `border-image` so it scales as a proper bezel around the LED-mask stage
// without distorting its corner ornaments.
import { assetUrl } from "../three/assetHost";

export interface MaskFrame {
  /** Stable id persisted to localStorage. */
  id: string;
  /** Short human label shown in the picker. */
  label: string;
  /** Public URL of the tile (resolved against Vite's BASE_URL). */
  src: string;
  /**
   * 9-slice inset in source pixels — how far in from each edge the stretchable
   * border ends. Tuned per visual weight of the tile's ornament/corners.
   */
  slice: number;
}

const url = (i: number) => assetUrl(`frames/frame-${String(i).padStart(2, "0")}.png`);

// Order + labels follow the reference sheet, left→right, top→bottom.
export const MASK_FRAMES: MaskFrame[] = [
  { id: "f00", label: "Ion Cyan", src: url(0), slice: 56 },
  { id: "f01", label: "Magenta Grid", src: url(1), slice: 56 },
  { id: "f02", label: "Console Blue", src: url(2), slice: 54 },
  { id: "f03", label: "Carbon Rose", src: url(3), slice: 58 },
  { id: "f04", label: "Teal Circuit", src: url(4), slice: 60 },
  { id: "f05", label: "Hazard Amber", src: url(5), slice: 60 },
  { id: "f06", label: "Crimson Gold", src: url(6), slice: 58 },
  { id: "f07", label: "Deep Sapphire", src: url(7), slice: 56 },
  { id: "f08", label: "Steel Rivet", src: url(8), slice: 58 },
  { id: "f09", label: "Violet Hex", src: url(9), slice: 56 },
  { id: "f10", label: "Red Hazard", src: url(10), slice: 60 },
  { id: "f11", label: "Amethyst Mesh", src: url(11), slice: 58 },
  { id: "f12", label: "Aqua Spark", src: url(12), slice: 56 },
  { id: "f13", label: "Neon Fade", src: url(13), slice: 54 },
  { id: "f14", label: "Worn Leather", src: url(14), slice: 60 },
  { id: "f15", label: "Cobalt Crest", src: url(15), slice: 56 },
];

export const FRAME_NONE = "none";
const STORAGE_KEY = "ledmask:frame";

const DEFAULT_FRAME = "f02";

function isValidFrameId(id: string | null): id is string {
  return id === FRAME_NONE || MASK_FRAMES.some((f) => f.id === id);
}

export function loadFrameId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    // Coerce unknown/stale ids (e.g. after the frame list changes) to the default.
    return isValidFrameId(saved) ? saved : DEFAULT_FRAME;
  } catch {
    return DEFAULT_FRAME;
  }
}

export function saveFrameId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable — selection just won't persist */
  }
}

export function findFrame(id: string): MaskFrame | undefined {
  return MASK_FRAMES.find((f) => f.id === id);
}
