/**
 * Pure animal AI state machine — no three.js.
 * States: idle → wander / graze → flee → dead → (corpse timed outside).
 */

export type AnimalAiState = "idle" | "wander" | "graze" | "flee" | "dead";

export interface AnimalBrainInput {
  state: AnimalAiState;
  /** Seconds in current state. */
  stateT: number;
  /** Distance to player (m). */
  distPlayer: number;
  /** Species detect range. */
  detectRange: number;
  temperament: "skittish" | "docile" | "aggressive" | "predator";
  /** True if animal took damage this frame. */
  hurt: boolean;
  /** Health after damage. */
  health: number;
  /** Wander goal reached. */
  atGoal: boolean;
}

export interface AnimalBrainOutput {
  state: AnimalAiState;
  stateT: number;
  /** Desired speed fraction 0..1 (0 = stop, 1 = flee speed). */
  speedFrac: number;
  /** Request a new wander goal. */
  pickNewGoal: boolean;
  /** Face away from player when fleeing. */
  fleeFromPlayer: boolean;
}

function nextState(input: AnimalBrainInput): AnimalAiState {
  if (input.health <= 0 || input.state === "dead") return "dead";
  if (input.hurt) return "flee";

  const spooked =
    input.distPlayer < input.detectRange &&
    (input.temperament === "skittish" ||
      input.temperament === "predator" ||
      (input.temperament === "docile" && input.distPlayer < input.detectRange * 0.55));

  if (spooked) return "flee";

  if (input.state === "flee") {
    // Stay fleeing until player is well away.
    if (input.distPlayer > input.detectRange * 1.6 && input.stateT > 1.2) return "idle";
    return "flee";
  }

  if (input.state === "idle" && input.stateT > 1.5 + (input.distPlayer % 1)) return "wander";
  if (input.state === "wander" && input.atGoal) return "graze";
  if (input.state === "graze" && input.stateT > 2.5) return "idle";
  if (input.state === "wander" && input.stateT > 8) return "idle";

  return input.state;
}

/**
 * Step the brain. Pure + deterministic given inputs.
 */
export function stepAnimalBrain(input: AnimalBrainInput, dt: number): AnimalBrainOutput {
  let state = nextState(input);
  let stateT = state === input.state ? input.stateT + dt : 0;
  let speedFrac = 0;
  let pickNewGoal = false;
  let fleeFromPlayer = false;

  switch (state) {
    case "dead":
      speedFrac = 0;
      break;
    case "idle":
      speedFrac = 0;
      break;
    case "graze":
      speedFrac = 0;
      break;
    case "wander":
      speedFrac = 0.45;
      if (stateT < dt * 1.5 || input.atGoal) pickNewGoal = true;
      break;
    case "flee":
      speedFrac = 1;
      fleeFromPlayer = true;
      if (stateT < dt * 1.5) pickNewGoal = true;
      break;
  }

  // Aggressive predators briefly hold ground when far; still flee when hurt/close.
  if (state === "idle" && input.temperament === "predator" && input.distPlayer < input.detectRange * 0.8) {
    state = "flee";
    stateT = 0;
    speedFrac = 1;
    fleeFromPlayer = true;
    pickNewGoal = true;
  }

  return { state, stateT, speedFrac, pickNewGoal, fleeFromPlayer };
}
