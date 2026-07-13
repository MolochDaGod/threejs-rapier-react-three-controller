/**
 * Dressing Room tool catalog. Every tool maps 1:1 to an existing `EditorScene`
 * setter — no new engine behaviour is introduced. Scoped to the Dressing Room:
 * character/gear/animation/effect operations plus selection, transform and
 * camera framing. The generic scene-authoring tools (primitives, structural
 * build brushes, colliders) were intentionally dropped along with their UI. The
 * system prompt embeds a fresh scene snapshot each turn so the model can target
 * real object ids in a single round-trip.
 */
import type { EditorScene } from "../three/editor/EditorScene";
import type {
  EditorSnapshot,
  GizmoMode,
} from "../three/editor/types";
import type { VoxelPart } from "../three/explorer/rig";
import {
  ABILITIES,
  registerAbility,
  statusAbility,
  vfxSkill,
} from "../three/abilities/abilityRegistry";
import type { AbilityTargetShape, TravelMotion } from "../three/abilities/abilityTypes";
import type { SkillKind, StatusId, StatusKind } from "../three/types";
import type { AiTool } from "./types";

const GIZMO_MODES: GizmoMode[] = ["translate", "rotate", "scale"];
/** Voxel-character parts the AI may recolour / pattern (subset of VoxelPart). */
const VOXEL_PARTS = ["skin", "shirt", "pants", "boot", "hat"] as const;
type VoxelPartArg = (typeof VOXEL_PARTS)[number];
const VFX_IDS = [
  "impact",
  "burst",
  "shockwave",
  "aoeBlast",
  "nova",
  "lightning",
  "muzzle",
  "impactExplode",
  "flame",
  "legFlame",
  "coneFlame",
  "stunMark",
  "shieldBreak",
];

/** Editable Skill Lab knobs, grouped by value type so one tool can coerce each. */
const SKILL_LAB_NUM_KEYS = [
  "overdrive",
  "armWidth",
  "clipFrom",
  "clipTo",
  "colliderX",
  "colliderY",
  "colliderZ",
  "colliderRadius",
] as const;
const SKILL_LAB_BOOL_KEYS = ["mirror", "slashFromCollider", "showCollider"] as const;
const SKILL_LAB_KEYS = [...SKILL_LAB_NUM_KEYS, ...SKILL_LAB_BOOL_KEYS, "vfxId", "clipName"];

/**
 * Mirrors of the {@link SkillKind} / {@link StatusId} / {@link StatusKind} /
 * {@link AbilityTargetShape} / {@link TravelMotion} unions as runtime value
 * lists for tool-arg validation. The `satisfies` guards make TypeScript fail the
 * build if a union member is added/removed without updating these lists.
 */
const SKILL_KINDS = [
  "slash",
  "slam",
  "bolt",
  "nova",
  "muzzle",
  "thrust",
  "fireDragon",
  "meteor",
  "turret",
  "darkBlades",
  "swordVolley",
  "soul",
  "laser",
] as const satisfies readonly SkillKind[];
const STATUS_IDS = [
  "burning",
  "frozen",
  "poisoned",
  "shocked",
  "hexed",
  "regen",
  "empowered",
  "shielded",
  "haste",
  "slowed",
  "stunned",
] as const satisfies readonly StatusId[];
const STATUS_KINDS = ["buff", "debuff"] as const satisfies readonly StatusKind[];
const ABILITY_TARGETS = ["self", "aimed", "aoe"] as const satisfies readonly AbilityTargetShape[];
const TRAVEL_MOTIONS = ["dragon", "darkBlades"] as const satisfies readonly TravelMotion[];

/** Parse a "#rrggbb" / "rrggbb" / 0x-prefixed / decimal colour into 0xRRGGBB. */
function parseColor(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input & 0xffffff;
  if (typeof input !== "string") return null;
  const s = input.trim().replace(/^#/, "").replace(/^0x/i, "");
  if (/^[0-9a-f]{6}$/i.test(s)) return parseInt(s, 16);
  const n = Number(input);
  return Number.isFinite(n) ? n & 0xffffff : null;
}

function asVec3(v: unknown): [number, number, number] | undefined {
  if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number")) {
    return [v[0], v[1], v[2]];
  }
  return undefined;
}

/**
 * Build the editor tool registry bound to a live engine accessor. Tools close
 * over `getEngine` so they always act on the current engine instance.
 */
export function buildEditorTools(
  getEngine: () => EditorScene | null,
  generatePattern?: (prompt: string) => Promise<string>,
): AiTool[] {
  const engine = (): EditorScene => {
    const e = getEngine();
    if (!e) throw new Error("The editor is not ready.");
    return e;
  };

  const asPart = (input: unknown): VoxelPart => {
    const p = String(input);
    if (!(VOXEL_PARTS as readonly string[]).includes(p)) throw new Error(`Unknown part "${input}".`);
    return p as VoxelPartArg;
  };

  return [
    {
      name: "select_object",
      description: "Select an object by its id (pass null to clear selection).",
      parameters: {
        type: "object",
        properties: { id: { type: ["string", "null"] } },
        required: ["id"],
      },
      execute: (args) => {
        const id = (args.id as string | null) ?? null;
        engine().select(id);
        return id ? `Selected ${id}` : "Cleared selection";
      },
    },
    {
      name: "delete_selected",
      description: "Delete the currently selected object.",
      parameters: { type: "object", properties: {} },
      execute: () => {
        engine().deleteSelected();
        return "Deleted the selection";
      },
    },
    {
      name: "duplicate_selected",
      description: "Duplicate the currently selected object.",
      parameters: { type: "object", properties: {} },
      execute: () => {
        engine().duplicateSelected();
        return "Duplicated the selection";
      },
    },
    {
      name: "rename_object",
      description: "Rename an object by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
      },
      execute: (args) => {
        engine().rename(String(args.id), String(args.name));
        return `Renamed to "${args.name}"`;
      },
    },
    {
      name: "set_object_color",
      description: "Set an object's material colour. Accepts a hex string like #ff3344.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, color: { type: "string" } },
        required: ["id", "color"],
      },
      execute: (args) => {
        const color = parseColor(args.color);
        if (color === null) throw new Error("Could not parse that colour.");
        engine().setObjectColor(String(args.id), color);
        return `Set colour of ${args.id}`;
      },
    },
    {
      name: "set_transform",
      description:
        "Set an object's position, rotation (degrees XYZ), and/or scale. Provide only the fields to change.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          rotation: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          scale: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        },
        required: ["id"],
      },
      execute: (args) => {
        engine().setTransform(String(args.id), {
          position: asVec3(args.position),
          rotation: asVec3(args.rotation),
          scale: asVec3(args.scale),
        });
        return `Transformed ${args.id}`;
      },
    },
    {
      name: "focus_selected",
      description: "Frame the camera on the currently selected object.",
      parameters: { type: "object", properties: {} },
      execute: () => {
        engine().focusSelected();
        return "Focused the selection";
      },
    },
    {
      name: "set_gizmo_mode",
      description: "Switch the transform gizmo between translate, rotate, and scale.",
      parameters: {
        type: "object",
        properties: { mode: { type: "string", enum: GIZMO_MODES } },
        required: ["mode"],
      },
      execute: (args) => {
        const mode = args.mode as GizmoMode;
        if (!GIZMO_MODES.includes(mode)) throw new Error(`Unknown gizmo mode "${mode}".`);
        engine().setGizmoMode(mode);
        return `Gizmo: ${mode}`;
      },
    },
    {
      name: "toggle_grid",
      description: "Show or hide the ground grid.",
      parameters: {
        type: "object",
        properties: { on: { type: "boolean" } },
        required: ["on"],
      },
      execute: (args) => {
        const on = Boolean(args.on);
        engine().toggleGrid(on);
        return on ? "Grid on" : "Grid off";
      },
    },
    {
      name: "set_bloom",
      description: "Enable or disable the bloom post-processing pass.",
      parameters: {
        type: "object",
        properties: { on: { type: "boolean" } },
        required: ["on"],
      },
      execute: (args) => {
        const on = Boolean(args.on);
        engine().setBloom(on);
        return on ? "Bloom on" : "Bloom off";
      },
    },
    {
      name: "play_vfx",
      description: "Play a one-shot visual effect preset at the scene focus point.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", enum: VFX_IDS } },
        required: ["id"],
      },
      execute: (args) => {
        const id = String(args.id);
        if (!VFX_IDS.includes(id)) throw new Error(`Unknown effect "${id}".`);
        engine().playVfx(id);
        return `Played ${id}`;
      },
    },
    {
      name: "recolor_character_part",
      description:
        "Recolour one part of the voxel character (the procedural blocky rig). Parts: skin, shirt, pants, boot, hat (use 'hat' for head wraps / hoods / caps). Colour is a hex string like #3aa0ff. Only works when a voxel character is loaded.",
      parameters: {
        type: "object",
        properties: {
          part: { type: "string", enum: [...VOXEL_PARTS] },
          color: { type: "string" },
        },
        required: ["part", "color"],
      },
      execute: (args) => {
        const part = asPart(args.part);
        const color = parseColor(args.color);
        if (color === null) throw new Error("Could not parse that colour.");
        engine().recolorRigPart(part, color);
        return `Recoloured the ${part}`;
      },
    },
    {
      name: "generate_character_pattern",
      description:
        "Generate a tiling pattern IMAGE from a text description and apply it as a texture to one part of the voxel character. Use for head wraps, clothing prints, camo, fabric, etc. Parts: skin, shirt, pants, boot, hat (use 'hat' for head wraps/hoods). Write a vivid, specific description of the motif and colours. Only works when a voxel character is loaded.",
      parameters: {
        type: "object",
        properties: {
          part: { type: "string", enum: [...VOXEL_PARTS] },
          prompt: { type: "string" },
        },
        required: ["part", "prompt"],
      },
      execute: async (args) => {
        if (!generatePattern) throw new Error("Pattern generation is unavailable.");
        const part = asPart(args.part);
        const desc = String(args.prompt ?? "").trim();
        if (!desc) throw new Error("Describe the pattern to generate.");
        const dataUrl = await generatePattern(
          `Seamless tileable flat pattern texture, top-down, no perspective, no shadows, no borders: ${desc}`,
        );
        await engine().applyRigPattern(part, dataUrl);
        return `Generated & applied a pattern to the ${part}`;
      },
    },
    {
      name: "clear_character_pattern",
      description:
        "Remove any generated pattern from a voxel character part, returning it to a flat colour. Parts: skin, shirt, pants, boot, hat.",
      parameters: {
        type: "object",
        properties: { part: { type: "string", enum: [...VOXEL_PARTS] } },
        required: ["part"],
      },
      execute: (args) => {
        const part = asPart(args.part);
        engine().clearRigPattern(part);
        return `Cleared the ${part} pattern`;
      },
    },
    {
      name: "set_skill_lab",
      description:
        "Tune one Skill Lab authoring knob on the Playground character (the active Play-mode rig, else the selected grudge character). Numeric knobs: overdrive (0.25–3 speed/intensity), armWidth (-1 tucked … +1 wide), clipFrom/clipTo (sub-clip in/out as a 0–1 fraction), colliderX/colliderY/colliderZ (damaging-collider centre offset), colliderRadius (AOE radius). Boolean knobs: mirror, slashFromCollider, showCollider. clipName: the clip to author (empty string clears it). vfxId: the effect fired on test_skill.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", enum: SKILL_LAB_KEYS },
          value: {
            description: "Number for numeric knobs, boolean for toggles, string for clipName / vfxId.",
          },
        },
        required: ["key", "value"],
      },
      execute: (args) => {
        const key = String(args.key);
        const raw = args.value;
        if ((SKILL_LAB_NUM_KEYS as readonly string[]).includes(key)) {
          const n = Number(raw);
          if (!Number.isFinite(n)) throw new Error(`"${key}" needs a number.`);
          engine().setSkillLab(key as (typeof SKILL_LAB_NUM_KEYS)[number], n);
          return `Set ${key} = ${n}`;
        }
        if ((SKILL_LAB_BOOL_KEYS as readonly string[]).includes(key)) {
          const b = raw === true || raw === "true" || raw === 1 || raw === "1";
          engine().setSkillLab(key as (typeof SKILL_LAB_BOOL_KEYS)[number], b);
          return `Set ${key} = ${b}`;
        }
        if (key === "vfxId") {
          const id = String(raw);
          if (!VFX_IDS.includes(id)) throw new Error(`Unknown effect "${id}".`);
          engine().setSkillLab("vfxId", id);
          return `Set vfxId = ${id}`;
        }
        if (key === "clipName") {
          const v = raw == null || raw === "" ? null : String(raw);
          engine().setSkillLab("clipName", v);
          return `Set clipName = ${v ?? "(none)"}`;
        }
        throw new Error(`Unknown Skill Lab knob "${key}".`);
      },
    },
    {
      name: "test_skill",
      description:
        "Preview the currently-authored skill on the Playground character: play the selected clip (sliced to the in/out range, mirrored + overdriven per the lab) and fire the chosen VFX. Use after set_skill_lab to see the result.",
      parameters: { type: "object", properties: {} },
      execute: () => {
        engine().testSkill();
        return "Previewed the authored skill";
      },
    },
    {
      name: "list_abilities",
      description:
        "List every ability currently in the data-driven ability library (id, display name, kind, target shape), including any created this session.",
      parameters: { type: "object", properties: {} },
      execute: () => {
        const ids = Object.keys(ABILITIES);
        if (ids.length === 0) return "No abilities are registered.";
        return ids
          .map((id) => {
            const a = ABILITIES[id];
            return `${a.id} — "${a.name}" — kind ${a.kind}, target ${a.target}`;
          })
          .join("\n");
      },
    },
    {
      name: "create_ability",
      description:
        "Create a new data-driven ability and add it to the library (resolvable by id afterwards). type 'vfx' builds an effect-driven skill from a kind (slash/slam/bolt/nova/muzzle/thrust/fireDragon/meteor/turret/darkBlades/swordVolley/soul/laser), a hex colour, a target shape (self/aimed/aoe), and an optional travel motion (dragon/darkBlades). type 'status' builds a buff/debuff aura from a statusId (burning/frozen/poisoned/shocked/regen/empowered/shielded/haste), an optional statusKind (buff/debuff), and whether it is AOE.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["vfx", "status"] },
          kind: { type: "string", enum: [...SKILL_KINDS] },
          color: { type: "string", description: "Hex colour like #ff8a3a (vfx only)." },
          target: { type: "string", enum: [...ABILITY_TARGETS] },
          travel: { type: "string", enum: [...TRAVEL_MOTIONS] },
          statusId: { type: "string", enum: [...STATUS_IDS] },
          statusKind: { type: "string", enum: [...STATUS_KINDS] },
          aoe: { type: "boolean" },
        },
        required: ["type"],
      },
      execute: (args) => {
        const type = String(args.type);
        if (type === "vfx") {
          const kind = String(args.kind);
          if (!(SKILL_KINDS as readonly string[]).includes(kind)) throw new Error(`Unknown skill kind "${kind}".`);
          const color = parseColor(args.color ?? "#ffffff");
          if (color === null) throw new Error("Could not parse that colour.");
          const target = args.target != null ? String(args.target) : "self";
          if (!(ABILITY_TARGETS as readonly string[]).includes(target)) throw new Error(`Unknown target "${target}".`);
          const travel = args.travel != null ? String(args.travel) : undefined;
          if (travel && !(TRAVEL_MOTIONS as readonly string[]).includes(travel)) {
            throw new Error(`Unknown travel motion "${travel}".`);
          }
          const def = vfxSkill(kind as SkillKind, color, {
            target: target as AbilityTargetShape,
            travel: travel as TravelMotion | undefined,
          });
          registerAbility(def);
          return `Created ability "${def.id}" (${def.kind}, target ${def.target}).`;
        }
        if (type === "status") {
          const id = String(args.statusId);
          if (!(STATUS_IDS as readonly string[]).includes(id)) throw new Error(`Unknown status "${id}".`);
          const k = args.statusKind != null ? String(args.statusKind) : undefined;
          if (k && !(STATUS_KINDS as readonly string[]).includes(k)) throw new Error(`Unknown status kind "${k}".`);
          const def = statusAbility(id as StatusId, k as StatusKind | undefined, Boolean(args.aoe));
          registerAbility(def);
          return `Created ability "${def.id}" (status ${id}).`;
        }
        throw new Error(`Unknown ability type "${type}". Use "vfx" or "status".`);
      },
    },
  ];
}

/** A compact, model-friendly description of the live scene for this turn. */
export function editorSystemPrompt(snap: EditorSnapshot | null): string {
  const lines: string[] = [
    "You are the AI Animation Creator embedded in the browser-based Dressing Room / Animator.",
    "Your job is to help create, fix, preview, and save animation clips and weapon skills for Three.js/Mixamo-style characters and Grudge characters.",
    "Use basic human-movement understanding: windup → contact/action → follow-through → recovery. Explain what body parts move, which clip to start from, and which Skill Lab knobs to tune.",
    "For weapon skills: first choose/equip a weapon in the Arsenal panel, then pick or author a clip in Animations/Skill Lab, set hit collider timing/radius, select melee/ranged + VFX, test_skill, then bind it to a skill slot so it persists for reuse across compatible characters.",
    "For Mixamo characters: prefer existing library clips as sources, slice with clipFrom/clipTo, mirror when needed, overdrive for speed, armWidth for stance, and collider offsets/radius for weapon contact.",
    "You can ANSWER questions about the editor and EXECUTE edits by calling the provided tools.",
    "Only act through the tools given to you; never claim to do anything outside them.",
    "When an action targets an object, use an exact id from the scene listing below — never invent ids.",
    "When asked to make an animation from chat, produce a concise recipe AND call tools when possible: set_skill_lab(clipName/clipFrom/clipTo/overdrive/mirror/armWidth/collider...), then test_skill.",
    "After performing actions, ALWAYS reply with one short, natural sentence confirming what you did and what to preview next.",
    "If a request is unsafe, out of scope, or impossible with the available tools, politely decline and say why in one sentence.",
    "",
  ];

  if (!snap) {
    lines.push("Scene state: (the Dressing Room is still loading).");
    return lines.join("\n");
  }

  lines.push(
    `Tools/state: gizmo=${snap.gizmo}, grid=${snap.showGrid ? "on" : "off"}, bloom=${
      snap.bloom ? "on" : "off"
    }.`,
  );

  lines.push(
    "Weapon/clip UX reminders: Arsenal panel equips weapons and edits hand grip, size, tip, and blade collider. Animations panel previews clips, renames/categorizes them, and binds clips to skill slots 1–5 with melee/ranged + VFX metadata. Clip labels/categories/skill bindings persist locally so authored skills can be reused across compatible Mixamo/Three.js characters.",
  );
  lines.push(`Selected: ${snap.selectedId ?? "(none)"}.`);
  lines.push(
    snap.rigIsVoxel
      ? "A procedural voxel character is loaded. You can recolour its parts (recolor_character_part) and GENERATE & apply pattern textures to its parts (generate_character_pattern) — parts: skin, shirt, pants, boot, hat (use 'hat' for head wraps/hoods). Use clear_character_pattern to remove a pattern."
      : "No procedural voxel character is loaded, so the voxel recolour/pattern tools won't apply until one is.",
  );

  const sl = snap.skillLab;
  if (sl.available) {
    const clips = sl.clips.length ? sl.clips.slice(0, 40).join(", ") : "(none loaded)";
    lines.push(
      `Skill Lab: a Playground character is available to author a skill on. Current — clip=${
        sl.clipName ?? "(none)"
      }, range=${sl.clipFrom.toFixed(2)}–${sl.clipTo.toFixed(2)}, overdrive=${sl.overdrive}, mirror=${sl.mirror}, armWidth=${sl.armWidth}, vfx=${sl.vfxId}, collider=(${sl.colliderX.toFixed(2)}, ${sl.colliderY.toFixed(2)}, ${sl.colliderZ.toFixed(2)}) r=${sl.colliderRadius.toFixed(2)}, showCollider=${sl.showCollider}.`,
    );
    lines.push(`Authorable clips: ${clips}.`);
    lines.push(
      "Animation creation flow: (1) infer movement phases from the prompt, (2) choose the closest source clip from Authorable clips, (3) set clipName, clipFrom/clipTo, overdrive, mirror, armWidth, and collider offset/radius, (4) call test_skill, (5) tell the user which slot/category to bind in the Animations panel. To clear the authored clip, set clipName to an empty string.",
    );
  } else {
    lines.push(
      "Skill Lab: no Playground character to author on yet (the Skill Lab tools need one loaded or selected in Play mode).",
    );
  }
  lines.push(
    "Abilities: list_abilities shows the data-driven ability library; create_ability adds a new 'vfx' (effect-driven skill) or 'status' (buff/debuff aura) entry to it. Use these after a clip previews correctly so the weapon skill can be reused.",
  );

  if (snap.objects.length === 0) {
    lines.push("Objects: (the scene is empty).");
  } else {
    lines.push(`Objects (${snap.objects.length}):`);
    for (const o of snap.objects.slice(0, 80)) {
      const [x, y, z] = o.position;
      const color = o.color !== null ? ` #${o.color.toString(16).padStart(6, "0")}` : "";
      const sel = o.selected ? " [selected]" : "";
      lines.push(
        `  ${o.id} — "${o.name}" — ${o.kind} @ (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})${color}${sel}`,
      );
    }
    if (snap.objects.length > 80) lines.push(`  …and ${snap.objects.length - 80} more.`);
  }

  return lines.join("\n");
}
