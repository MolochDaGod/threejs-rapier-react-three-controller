/**
 * Input contract SSOT for the Animator / Danger Room.
 * ---------------------------------------------------------------------------
 * Mirrors grudox/js/grudge-control-ssot.js and character-animator
 * lib/game-content/src/controller.ts so Shift sprint, WASD, jump stay aligned
 * across products. Controllers should import codes from here — not hardcode.
 */

/** KeyboardEvent.code bindings for shared actions. */
export const INPUT = {
  moveForward: "KeyW",
  moveBack: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  /** Hold to sprint (gait band). */
  sprint: "ShiftLeft",
  sprintAlt: "ShiftRight",
  jump: "Space",
  crouch: "ControlLeft",
  dodge: "KeyC",
} as const;

export type InputAction = keyof typeof INPUT;

/** True if this KeyboardEvent.code is a sprint binding. */
export function isSprintCode(code: string): boolean {
  return code === INPUT.sprint || code === INPUT.sprintAlt;
}

/**
 * Clips that must never be used as Grudge6/Bip001 sprint.
 * (Baked ~180° off the rest of the loco set → spin / moonwalk.)
 */
export const BANNED_SPRINT_RELS = ["uploads_2026_06/locomotion/running"] as const;

export function isBannedSprintRel(rel: string): boolean {
  const r = String(rel || "")
    .replace(/\\/g, "/")
    .replace(/\.json$/i, "");
  return BANNED_SPRINT_RELS.some((b) => r === b || r.endsWith(`/${b}`));
}
