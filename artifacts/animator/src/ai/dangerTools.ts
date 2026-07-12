/**
 * Danger Room tool catalog. Tools map 1:1 to the existing App-level callbacks
 * (the same ones the Admin and Settings panels drive) and the Studio setters
 * behind them — no new gameplay systems. The system prompt embeds the live
 * roster and tuning so the model can act in a single round-trip.
 */
import { CHARACTERS, WEAPONS } from "../three/assets";
import type { Difficulty, EditorParams, Faction, WeaponId } from "../three/types";
import type { AiTool } from "./types";

const WEAPON_IDS = WEAPONS.map((w) => w.id);
const CHARACTER_IDS = CHARACTERS.map((c) => c.id);
const DIFFICULTIES: Difficulty[] = ["passive", "easy", "medium", "hard"];
const FACTIONS: Faction[] = ["enemy", "ally"];

/** Numeric tuning fields exposed for `set_param`, with friendly bounds. */
const PARAM_FIELDS: { key: keyof EditorParams; min: number; max: number; label: string }[] = [
  { key: "moveSpeed", min: 0.5, max: 12, label: "move speed" },
  { key: "sprintMultiplier", min: 1, max: 4, label: "sprint multiplier" },
  { key: "jumpHeight", min: 0.3, max: 8, label: "jump height" },
  { key: "gravity", min: 4, max: 60, label: "gravity" },
  { key: "cameraDistance", min: 1.5, max: 14, label: "camera distance" },
  { key: "cameraHeight", min: 0.4, max: 5, label: "camera height" },
  { key: "mouseSensitivity", min: 0.1, max: 4, label: "mouse sensitivity" },
  { key: "fov", min: 30, max: 110, label: "field of view" },
  { key: "turnResponsiveness", min: 1, max: 30, label: "turn responsiveness" },
  { key: "blendTime", min: 0, max: 1, label: "animation blend time" },
  { key: "modelYaw", min: -Math.PI, max: Math.PI, label: "model yaw" },
  { key: "dashDistance", min: 1, max: 16, label: "dash distance" },
  { key: "aoeRadius", min: 0.5, max: 12, label: "AoE radius" },
  { key: "skillForce", min: 0, max: 40, label: "skill knockback" },
  { key: "skyfallBolts", min: 1, max: 24, label: "skyfall bolts" },
];

/** Boolean tuning toggles for `set_param`. */
const TOGGLE_FIELDS: { key: keyof EditorParams; label: string }[] = [
  { key: "showSkeleton", label: "skeleton overlay" },
  { key: "invertY", label: "invert vertical look" },
];

export interface DangerHandlers {
  onCharacter: (id: string) => void;
  onWeapon: (id: WeaponId) => void;
  onDifficulty: (d: Difficulty) => void;
  onSpawn: (weaponId: WeaponId, faction: Faction) => void;
  onSpawnBoss: (weaponId: WeaponId) => void;
  onClearNpcs: () => void;
  onParam: (patch: Partial<EditorParams>) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Build the Danger Room tool registry bound to the live App callbacks. */
export function buildDangerTools(handlers: DangerHandlers): AiTool[] {
  return [
    {
      name: "set_player_character",
      description: "Switch the player to a different character rig.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", enum: CHARACTER_IDS } },
        required: ["id"],
      },
      execute: (args) => {
        const id = String(args.id);
        if (!CHARACTER_IDS.includes(id)) throw new Error(`Unknown character "${id}".`);
        handlers.onCharacter(id);
        return `Player: ${id}`;
      },
    },
    {
      name: "set_player_weapon",
      description: "Equip the player with a weapon class.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", enum: WEAPON_IDS } },
        required: ["id"],
      },
      execute: (args) => {
        const id = args.id as WeaponId;
        if (!WEAPON_IDS.includes(id)) throw new Error(`Unknown weapon "${id}".`);
        handlers.onWeapon(id);
        return `Weapon: ${id}`;
      },
    },
    {
      name: "set_difficulty",
      description: "Set the sparring difficulty for spawned opponents.",
      parameters: {
        type: "object",
        properties: { difficulty: { type: "string", enum: DIFFICULTIES } },
        required: ["difficulty"],
      },
      execute: (args) => {
        const d = args.difficulty as Difficulty;
        if (!DIFFICULTIES.includes(d)) throw new Error(`Unknown difficulty "${d}".`);
        handlers.onDifficulty(d);
        return `Difficulty: ${d}`;
      },
    },
    {
      name: "spawn_npc",
      description:
        "Spawn one sparring NPC wielding a given weapon, on the enemy or ally faction.",
      parameters: {
        type: "object",
        properties: {
          weapon: { type: "string", enum: WEAPON_IDS },
          faction: { type: "string", enum: FACTIONS },
          count: { type: "integer", minimum: 1, maximum: 10 },
        },
        required: ["weapon", "faction"],
      },
      execute: (args) => {
        const weapon = args.weapon as WeaponId;
        if (!WEAPON_IDS.includes(weapon)) throw new Error(`Unknown weapon "${weapon}".`);
        const faction = args.faction as Faction;
        if (!FACTIONS.includes(faction)) throw new Error(`Unknown faction "${faction}".`);
        const count = Math.max(1, Math.min(10, Math.round(Number(args.count ?? 1))));
        for (let i = 0; i < count; i++) handlers.onSpawn(weapon, faction);
        return `Spawned ${count} ${faction} ${weapon}${count === 1 ? "" : "s"}`;
      },
    },
    {
      name: "spawn_boss",
      description: "Spawn a tougher boss NPC wielding a given weapon.",
      parameters: {
        type: "object",
        properties: { weapon: { type: "string", enum: WEAPON_IDS } },
        required: ["weapon"],
      },
      execute: (args) => {
        const weapon = args.weapon as WeaponId;
        if (!WEAPON_IDS.includes(weapon)) throw new Error(`Unknown weapon "${weapon}".`);
        handlers.onSpawnBoss(weapon);
        return `Spawned a ${weapon} boss`;
      },
    },
    {
      name: "clear_npcs",
      description: "Remove all spawned NPCs from the Danger Room.",
      parameters: { type: "object", properties: {} },
      execute: () => {
        handlers.onClearNpcs();
        return "Cleared all NPCs";
      },
    },
    {
      name: "set_param",
      description:
        "Tune a movement, camera, or combat parameter. Use 'field' with a numeric 'value', or a boolean toggle field with 'enabled'.",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: [...PARAM_FIELDS.map((f) => f.key), ...TOGGLE_FIELDS.map((f) => f.key)],
          },
          value: { type: "number" },
          enabled: { type: "boolean" },
        },
        required: ["field"],
      },
      execute: (args) => {
        const field = String(args.field) as keyof EditorParams;
        const toggle = TOGGLE_FIELDS.find((f) => f.key === field);
        if (toggle) {
          if (typeof args.enabled !== "boolean")
            throw new Error(`"${toggle.label}" needs enabled true/false.`);
          handlers.onParam({ [field]: args.enabled } as Partial<EditorParams>);
          return `${toggle.label}: ${args.enabled ? "on" : "off"}`;
        }
        const spec = PARAM_FIELDS.find((f) => f.key === field);
        if (!spec) throw new Error(`Unknown parameter "${field}".`);
        if (typeof args.value !== "number" || !Number.isFinite(args.value))
          throw new Error(`"${spec.label}" needs a numeric value.`);
        const v = clamp(args.value, spec.min, spec.max);
        handlers.onParam({ [field]: v } as Partial<EditorParams>);
        return `${spec.label}: ${v}`;
      },
    },
  ];
}

export interface DangerState {
  characterId: string;
  weaponId: WeaponId;
  difficulty: Difficulty;
  params: EditorParams;
}

/** A compact, model-friendly description of the live Danger Room for this turn. */
export function dangerSystemPrompt(state: DangerState): string {
  const params = PARAM_FIELDS.map((f) => `${String(f.key)}=${state.params[f.key]}`).join(", ");
  const toggles = TOGGLE_FIELDS.map((f) => `${String(f.key)}=${state.params[f.key]}`).join(", ");
  return [
    "You are the AI master assistant embedded in the Animator 'Danger Room', a third-person combat & movement sandbox.",
    "You can ANSWER questions and EXECUTE changes by calling the provided tools (swap character/weapon, set difficulty, spawn or clear NPCs, and tune movement/camera/combat parameters).",
    "Only act through the tools given to you; never claim to do anything outside them.",
    "After performing actions, ALWAYS reply with one short, natural sentence confirming what you did.",
    "If a request is unsafe, out of scope, or impossible with the available tools, politely decline and say why in one sentence.",
    "",
    `Characters: ${CHARACTER_IDS.join(", ")}.`,
    `Weapons: ${WEAPON_IDS.join(", ")}.`,
    `Difficulties: ${DIFFICULTIES.join(", ")}.`,
    "",
    `Current: character=${state.characterId}, weapon=${state.weaponId}, difficulty=${state.difficulty}.`,
    `Parameters: ${params}.`,
    `Toggles: ${toggles}.`,
  ].join("\n");
}
