/**
 * Device-local toggle for the Racalvin DJ booth's animated GLSL light show.
 * Persisted in localStorage and defaults to ON. Kept tiny and self-contained,
 * mirroring the other dangerroom:* settings stores.
 *
 * This is the animator artifact, so NOTHING here may import `@workspace/*`.
 */

const KEY = "dangerroom:djshow";

/** Whether the DJ light show is enabled (defaults to true when unset/corrupt). */
export function loadDjShow(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

export function saveDjShow(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}
