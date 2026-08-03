/**
 * Input contract SSOT for the Animator / Danger Room.
 * ---------------------------------------------------------------------------
 * Mirrors grudox/js/grudge-control-ssot.js and character-animator
 * lib/game-content/src/controller.ts so Shift sprint, WASD, jump stay aligned
 * across products. Controllers should import codes from here — not hardcode.
 */

/**
 * KeyboardEvent.code bindings for shared actions.
 * Fleet combat SSOT: **X** dodge · **C** parry · **E** block · Space jump.
 * (Do not map dodge to C — that is parry on this bar and Open/fleet.)
 */
export const INPUT = {
  moveForward: "KeyW",
  moveBack: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  /** Hold to sprint (gait band). */
  sprint: "ShiftLeft",
  sprintAlt: "ShiftRight",
  jump: "Space",
  /** Legacy crouch alias only — combat block is {@link INPUT.block}. */
  crouch: "ControlLeft",
  /** Quick back dodge (Studio.dodgeRoll "B"). */
  dodge: "KeyX",
  /** Timing parry window. */
  parry: "KeyC",
  /** Hold block / guard. */
  block: "KeyE",
  /**
   * Camp lab build mode on/off (Danger Room Phase D / kenney-build).
   * Not a fleet combat residual — local Conan pad. First/third is {@link INPUT.viewToggle}.
   */
  campBuild: "KeyB",
  /** First / third person camera (Danger Room; was KeyB before camp claimed B). */
  viewToggle: "KeyK",
  /** Harvest tool wheel (Open harvestTools SSOT). */
  toolWheel: "KeyU",
} as const;

/**
 * Activity-mode hotkey matrix (Danger Room survival lab).
 * Full resolver: `activityInput.ts` — combat · harvest · build.
 *
 * | Key | combat | harvest | build |
 * |-----|--------|---------|-------|
 * | B   | → build | → build | → combat |
 * | U   | → harvest+wheel | toggle wheel | → harvest+wheel |
 * | Esc | cast cancel | wheel off / → combat | → combat |
 * | LMB | attack | harvest strike | place |
 * | RMB | hard lock | hard lock | remove |
 * | R   | heavy/reload | — | rotate |
 * | Y   | — | — | cycle piece |
 * | 1–4 | skills | tools | — |
 * | X/C/E/F | dodge/parry/block/skill | dodge/block only | — |
 */

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
