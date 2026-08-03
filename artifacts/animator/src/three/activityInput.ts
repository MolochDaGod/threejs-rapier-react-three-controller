/**
 * Activity-mode input SSOT — combat · harvest · build.
 *
 * Pure resolver so hotkeys can be unit-tested without Studio/WebGL.
 * Studio dispatches the returned intent; it does not invent parallel maps.
 *
 * Invariants (enforced by {@link normalizeActivityState}):
 *  - toolWheelOpen ⇒ mode === "harvest"
 *  - mode === "build" ⇒ toolWheelOpen === false
 *
 * Mode transitions:
 *  - **B** toggles build ↔ combat (exits harvest + wheel)
 *  - **U** harvest + wheel (exits build); again toggles wheel only
 *  - **Esc** cast cancel → close wheel → exit build → exit harvest → combat
 *  - Combat residuals only in **combat** (harvest: dodge/block/butcher + tools)
 *  - Build: R rotate · Y cycle · LMB place · RMB remove
 *  - Harvest: LMB strike · 1–4 tools · no M3 motion attack
 */

import { INPUT } from "./inputContract";

export type ActivityMode = "combat" | "harvest" | "build";

export type KeyIntent =
  | { type: "noop" }
  | { type: "jump" }
  | { type: "view_toggle" }
  | { type: "escape" }
  | { type: "toggle_build" }
  | { type: "toggle_harvest_wheel" }
  | { type: "build_rotate" }
  | { type: "build_cycle" }
  | { type: "tool_slot"; index: number }
  | { type: "combat_block" }
  | { type: "combat_parry" }
  | { type: "combat_dodge" }
  | { type: "combat_heavy_or_reload" }
  | { type: "combat_skill"; slot?: number }
  | { type: "combat_loadout" }
  | { type: "combat_evade" }
  | { type: "combat_mech" }
  | { type: "combat_stab" }
  | { type: "combat_stomp" }
  | { type: "combat_kick" }
  | { type: "combat_bomb" }
  | { type: "combat_heal" }
  | { type: "combat_butcher" };

export type MouseIntent =
  | { type: "noop" }
  | { type: "cast_confirm" }
  | { type: "cast_cancel" }
  | { type: "build_place" }
  | { type: "build_remove" }
  | { type: "attack" }
  | { type: "motion_attack" }
  | { type: "lock_toggle" };

export interface ActivityInputState {
  mode: ActivityMode;
  toolWheelOpen: boolean;
  /** Cast targeting active (ground AOE etc.) — highest priority. */
  castActive: boolean;
}

export interface NormalizedActivity {
  mode: ActivityMode;
  toolWheelOpen: boolean;
}

/**
 * Enforce mode/wheel consistency. Call after every transition and before resolve.
 */
export function normalizeActivityState(
  mode: ActivityMode,
  toolWheelOpen: boolean,
): NormalizedActivity {
  if (mode === "build") {
    return { mode: "build", toolWheelOpen: false };
  }
  if (toolWheelOpen && mode !== "harvest") {
    // Wheel without harvest is illegal — promote to harvest (keep wheel).
    return { mode: "harvest", toolWheelOpen: true };
  }
  if (mode === "harvest") {
    return { mode: "harvest", toolWheelOpen: !!toolWheelOpen };
  }
  return { mode: "combat", toolWheelOpen: false };
}

/** Always-available locomotion / meta (any mode). */
function isMetaJump(code: string): boolean {
  return code === INPUT.jump || code === "Space";
}

function isDigitTool(code: string): number | null {
  if (code === "Digit1") return 0;
  if (code === "Digit2") return 1;
  if (code === "Digit3") return 2;
  if (code === "Digit4") return 3;
  return null;
}

/**
 * Resolve a key in the current activity mode.
 * State is normalized first so illegal mode/wheel pairs cannot dispatch wrong intents.
 */
export function resolveActivityKey(state: ActivityInputState, code: string): KeyIntent {
  const { mode, toolWheelOpen } = normalizeActivityState(state.mode, state.toolWheelOpen);
  const s: ActivityInputState = { mode, toolWheelOpen, castActive: state.castActive };

  if (code === "Escape") return { type: "escape" };

  // Mode switches always available
  if (code === INPUT.campBuild || code === "KeyB") return { type: "toggle_build" };
  if (code === INPUT.toolWheel || code === "KeyU") return { type: "toggle_harvest_wheel" };
  if (code === INPUT.viewToggle || code === "KeyK") return { type: "view_toggle" };

  if (isMetaJump(code)) return { type: "jump" };

  // ---- BUILD ----
  if (s.mode === "build") {
    if (code === "KeyR") return { type: "build_rotate" };
    if (code === "KeyY") return { type: "build_cycle" };
    return { type: "noop" };
  }

  // ---- HARVEST ----
  if (s.mode === "harvest") {
    const slot = isDigitTool(code);
    if (slot != null) return { type: "tool_slot", index: slot };
    if (code === INPUT.dodge || code === "KeyX") return { type: "combat_dodge" };
    if (code === INPUT.block || code === "KeyE") return { type: "combat_block" };
    if (code === "ControlLeft" || code === "ControlRight") return { type: "combat_block" };
    if (code === "KeyN") return { type: "combat_butcher" };
    // No skill bar / heavy / parry while harvesting
    return { type: "noop" };
  }

  // ---- COMBAT ----
  if (code === INPUT.block || code === "KeyE") return { type: "combat_block" };
  if (code === "ControlLeft" || code === "ControlRight") return { type: "combat_block" };
  if (code === "KeyR") return { type: "combat_heavy_or_reload" };
  if (code === "KeyF") return { type: "combat_skill" };
  if (code === "KeyQ") return { type: "combat_loadout" };
  if (code === INPUT.dodge || code === "KeyX") return { type: "combat_dodge" };
  if (code === "KeyG") return { type: "combat_evade" };
  if (code === "KeyM") return { type: "combat_mech" };
  if (code === "KeyZ") return { type: "combat_stab" };
  if (code === "KeyT") return { type: "combat_stomp" };
  if (code === "KeyV") return { type: "combat_kick" };
  if (code === "KeyH") return { type: "combat_bomb" };
  if (code === "KeyJ") return { type: "combat_heal" };
  if (code === INPUT.parry || code === "KeyC") return { type: "combat_parry" };
  if (code === "KeyN") return { type: "combat_butcher" };
  const combatSlot = isDigitTool(code);
  if (combatSlot != null) return { type: "combat_skill", slot: combatSlot };

  return { type: "noop" };
}

/**
 * Resolve mouse button (0 LMB, 1 MMB, 2 RMB) for the activity mode.
 */
export function resolveActivityMouse(
  state: ActivityInputState,
  button: number,
): MouseIntent {
  const { mode } = normalizeActivityState(state.mode, state.toolWheelOpen);

  if (state.castActive) {
    if (button === 0) return { type: "cast_confirm" };
    if (button === 2) return { type: "cast_cancel" };
    return { type: "noop" };
  }

  if (mode === "build") {
    if (button === 0) return { type: "build_place" };
    if (button === 2) return { type: "build_remove" };
    return { type: "noop" };
  }

  if (mode === "harvest") {
    // LMB harvest strike (same attack pipeline stages nodes); no M3 combat motion.
    if (button === 0) return { type: "attack" };
    if (button === 2) return { type: "lock_toggle" };
    return { type: "noop" };
  }

  // combat
  if (button === 0) return { type: "attack" };
  if (button === 1) return { type: "motion_attack" };
  if (button === 2) return { type: "lock_toggle" };
  return { type: "noop" };
}

/**
 * Apply mode transition for toggle_build.
 * Always ends harvest wheel. Leaving build returns to **combat** (not prior harvest).
 */
export function applyToggleBuild(
  mode: ActivityMode,
  toolWheelOpen: boolean,
  buildWasActive: boolean,
): NormalizedActivity & { buildOn: boolean } {
  if (buildWasActive || mode === "build") {
    return { ...normalizeActivityState("combat", false), buildOn: false };
  }
  return { ...normalizeActivityState("build", false), buildOn: true };
}

/**
 * Apply toggle_harvest_wheel.
 * Always exits build. Wheel only legal in harvest.
 */
export function applyToggleHarvestWheel(
  mode: ActivityMode,
  toolWheelOpen: boolean,
): NormalizedActivity & { exitBuild: boolean } {
  if (mode !== "harvest") {
    return { ...normalizeActivityState("harvest", true), exitBuild: true };
  }
  return {
    ...normalizeActivityState("harvest", !toolWheelOpen),
    exitBuild: true,
  };
}

/**
 * Escape stack (highest first):
 * 1. Cancel cast
 * 2. Close tool wheel (stay harvest)
 * 3. Exit build → combat
 * 4. Exit harvest → combat
 */
export function applyEscape(
  mode: ActivityMode,
  toolWheelOpen: boolean,
  castActive: boolean,
): NormalizedActivity & {
  exitBuild: boolean;
  cancelCast: boolean;
  handled: boolean;
} {
  // Cast wins over wheel — mid-skill aim must be cancellable immediately.
  if (castActive) {
    return {
      ...normalizeActivityState(mode, toolWheelOpen),
      exitBuild: false,
      cancelCast: true,
      handled: true,
    };
  }

  const n = normalizeActivityState(mode, toolWheelOpen);

  if (n.toolWheelOpen) {
    return {
      ...normalizeActivityState("harvest", false),
      exitBuild: false,
      cancelCast: false,
      handled: true,
    };
  }
  if (n.mode === "build") {
    return {
      ...normalizeActivityState("combat", false),
      exitBuild: true,
      cancelCast: false,
      handled: true,
    };
  }
  if (n.mode === "harvest") {
    return {
      ...normalizeActivityState("combat", false),
      exitBuild: false,
      cancelCast: false,
      handled: true,
    };
  }
  return {
    ...n,
    exitBuild: false,
    cancelCast: false,
    handled: false,
  };
}

/** True if this mode may start/hold block (E). */
export function modeAllowsBlock(mode: ActivityMode): boolean {
  return mode === "combat" || mode === "harvest";
}

/** True if combat residuals (parry/skills/heavy/…) are live. */
export function modeAllowsCombatSkills(mode: ActivityMode): boolean {
  return mode === "combat";
}
