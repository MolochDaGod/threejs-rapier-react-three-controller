/**
 * Pure, deterministic defensive-combat outcome resolver.
 *
 * No globals, no randomness — given an incoming attack payload and a defender's
 * chosen action + timing, returns a typed {@link DefensiveResult}. Both hosts
 * (voxel Game Studio and the Animator sparring room) run this verbatim; the
 * CombatController calls it internally and the host only observes the result.
 *
 * ## Outcome decision tree
 *
 * ```
 * PARRY (timing ≤ deflect window)
 *   ├─ timing ≤ perfect window  → perfectParry  (attacker: parried state)
 *   ├─ def.force ≥ atk.force    → deflect       (no damage)
 *   └─ def.force < atk.force    → hit           (full damage)
 * PARRY (timing > deflect window) → hit (missed the window)
 *
 * BLOCK (stamina available)
 *   ├─ attack.shieldBreak       → blockStop  (defender: stunned)
 *   ├─ def.force ≥ atk.force    → blockStop  (motion halted, no knockback)
 *   └─ def.force < atk.force    → hit        (broke through block)
 *
 * DODGE
 *   ├─ age ≤ punish window      → dodgePunish  (attacker: dodgePunished stumble)
 *   ├─ i-frame (invincible)     → dodgeEvade   (complete avoidance)
 *   └─ outside window           → hit          (too late)
 *
 * NONE / equal-force exchange   → deflect (elastic bounce) | hit
 * ```
 *
 * ## Elastic-collision rule (equal forces)
 * When `atk.force === def.force` and the defender is NOT in `none` action,
 * the exchange resolves as `deflect` — both sides bounce with no damage, per
 * the equal-opposing-forces diagram. The stronger force always wins initiative.
 */

import type {
  AttackPayload,
  DefensePayload,
  DefensiveResult,
  VulnerableState,
} from "./types.js";

/** Seconds: wider parry window that negates damage. */
export const PARRY_DEFLECT_WINDOW = 0.45;
/** Seconds: tighter perfect-parry window that also launches the attacker. */
export const PARRY_PERFECT_WINDOW = 0.15;
/** Seconds: dodge "punish" window — attacker is rerouted into a stumble. */
export const DODGE_PUNISH_WINDOW = 0.12;

/** Build a clean hit result with full damage and no special reactions. */
function hitResult(attack: AttackPayload): DefensiveResult {
  return {
    outcome: "hit",
    damageDealt: attack.damage,
    poiseDamageDealt: attack.poiseDamage,
    attackerReaction: "none",
    defenderReaction: "none",
    critWindow: false,
  };
}

/**
 * Resolve a defensive exchange.
 *
 * @param attack   The incoming attack's force + timing metadata.
 * @param defense  The defender's chosen action, force, and reaction timing.
 * @param invincible  Whether the defender is currently in dodge i-frames
 *                    (set by the CombatController dodge state machine).
 */
export function resolveDefense(
  attack: AttackPayload,
  defense: DefensePayload,
  invincible: boolean,
): DefensiveResult {
  // Elastic-collision: equal forces → bounce, no damage, no reactions.
  if (defense.action !== "none" && attack.force === defense.force) {
    return {
      outcome: "deflect",
      damageDealt: 0,
      poiseDamageDealt: 0,
      attackerReaction: "none",
      defenderReaction: "none",
      critWindow: false,
    };
  }

  switch (defense.action) {
    // ---------------------------------------------------------------------- parry
    case "parry": {
      if (defense.age <= PARRY_PERFECT_WINDOW) {
        return {
          outcome: "perfectParry",
          damageDealt: 0,
          poiseDamageDealt: 0,
          attackerReaction: "parried" as VulnerableState,
          defenderReaction: "none",
          critWindow: false,
        };
      }
      if (defense.age <= PARRY_DEFLECT_WINDOW) {
        if (defense.force >= attack.force) {
          return {
            outcome: "deflect",
            damageDealt: 0,
            poiseDamageDealt: 0,
            attackerReaction: "none",
            defenderReaction: "none",
            critWindow: false,
          };
        }
        // Force overwhelms the parry — partial damage, no stagger reaction.
        return {
          outcome: "hit",
          damageDealt: Math.round(attack.damage * 0.5),
          poiseDamageDealt: Math.round(attack.poiseDamage * 0.5),
          attackerReaction: "none",
          defenderReaction: "none",
          critWindow: false,
        };
      }
      // Outside the window — clean hit.
      return hitResult(attack);
    }

    // ---------------------------------------------------------------------- block
    case "block": {
      // shieldBreak (from a heavy/"R" skill) forces the blocker into a stun.
      if (attack.shieldBreak) {
        return {
          outcome: "blockStop",
          damageDealt: 0,
          poiseDamageDealt: 0,
          attackerReaction: "none",
          defenderReaction: "stunned" as VulnerableState,
          critWindow: true,
        };
      }
      if (defense.force >= attack.force) {
        return {
          outcome: "blockStop",
          damageDealt: 0,
          poiseDamageDealt: 0,
          attackerReaction: "none",
          defenderReaction: "none",
          critWindow: false,
        };
      }
      // Attack force exceeds block — breaks through.
      return hitResult(attack);
    }

    // ---------------------------------------------------------------------- dodge
    case "dodge": {
      if (defense.age <= DODGE_PUNISH_WINDOW) {
        return {
          outcome: "dodgePunish",
          damageDealt: 0,
          poiseDamageDealt: 0,
          attackerReaction: "dodgePunished" as VulnerableState,
          defenderReaction: "none",
          critWindow: false,
        };
      }
      if (invincible) {
        return {
          outcome: "dodgeEvade",
          damageDealt: 0,
          poiseDamageDealt: 0,
          attackerReaction: "none",
          defenderReaction: "none",
          critWindow: false,
        };
      }
      // Dodge attempted but too late / outside i-frame — hit lands.
      return hitResult(attack);
    }

    // -------------------------------------------------------------------- no defense
    case "none":
    default:
      return hitResult(attack);
  }
}
