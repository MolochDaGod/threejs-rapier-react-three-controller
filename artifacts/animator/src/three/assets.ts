import type { CharacterDef, WeaponCombat, WeaponDef, WeaponId } from "./types";
import { WEAPONS } from "./arsenal";
import { resolveCombat } from "./arsenal/holdStyle";

export { WEAPONS };

import { assetUrl } from "./assetHost";

/** Resolve a public asset path under the configured asset host (see assetHost.ts). */
export function asset(path: string): string {
  if (/^([a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  return assetUrl(path);
}

/** Same-origin (+ optional CDN) candidates for resilient GLB loads. */
export function assetCandidates(path: string): string[] {
  if (!path) return [];
  if (/^([a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return [path];
  const rel = path.replace(/^\/+/, "");
  const urls = [asset(rel)];
  // Optional production CDN alias when local public/ is missing a prop.
  if (!rel.startsWith("http")) {
    urls.push(`https://assets.grudge-studio.com/${rel}`);
  }
  return [...new Set(urls)];
}

/** Try each path until a GLB/GLTF loads. */
export async function loadGltfFirst(
  paths: string | string[],
  loader: {
    loadAsync: (url: string) => Promise<{
      scene: import("three").Object3D;
      animations?: import("three").AnimationClip[];
    }>;
  },
): Promise<{
  scene: import("three").Object3D;
  animations: import("three").AnimationClip[];
  url: string;
}> {
  const pathList = Array.isArray(paths) ? paths : [paths];
  let lastErr: unknown;
  for (const p of pathList) {
    if (!p) continue;
    for (const url of assetCandidates(p)) {
      try {
        const gltf = await loader.loadAsync(url);
        return {
          scene: gltf.scene,
          animations: gltf.animations ?? [],
          url,
        };
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr ?? new Error(`Failed to load: ${pathList.join(", ")}`);
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: "explorer",
    name: "Explorer",
    file: "",
    scale: 1,
    clips: {
      idle: "idle",
      walk: "walk",
      run: "run",
      attack: "attack",
      jump: "jump",
      death: "death",
      hurt: "hit",
      block: "block",
    },
    signatureSkills: [
      { label: "Combo Strike", clip: "attack2", kind: "slash" },
      { label: "Arcane Nova", clip: "magicArea", kind: "nova" },
      { label: "Freeze Dash", clip: "dash", kind: "slam", mode: "dash" },
      { label: "Power Throw", clip: "throw", kind: "muzzle" },
    ],
    handBone: "hand",
    modelYaw: 0,
    procedural: true,
    // Procedural Explorer rig (same hand pose proven on the Archmage): launch the
    // Combo Strike slash + basic melee swings from the swinging hand's collider
    // pose so the cuts tilt/roll to the real swing plane instead of flat facing.
    colliderVfx: true,
  },
  {
    id: "led-monk",
    name: "LED Monk",
    file: "",
    scale: 1,
    clips: {
      idle: "idle",
      walk: "walk",
      run: "run",
      attack: "attack",
      jump: "jump",
      death: "death",
      hurt: "hit",
      block: "block",
    },
    signatureSkills: [
      { label: "Combo Strike", clip: "attack2", kind: "slash" },
      { label: "Arcane Nova", clip: "magicArea", kind: "nova" },
      { label: "Freeze Dash", clip: "dash", kind: "slam", mode: "dash" },
      { label: "Power Throw", clip: "throw", kind: "muzzle" },
    ],
    // F-skill drops a snare field — a persistent tar-pit gadget that re-pulses a
    // movement slow + chip damage on enemies who stand in it (the zone-control
    // counterpart to the Archmage's turret), built on the deploy ability lifecycle.
    gadget: "snareField",
    handBone: "hand",
    modelYaw: 0,
    procedural: true,
    colliderVfx: true,
    // Styled Explorer variant: a baked (static) LED-visor head + hood and a
    // flowing cape. Shares all the Explorer's clips/skills — only the appearance
    // differs via `look`.
    look: {
      shirt: "#15171f",
      pants: "#0f1117",
      hat: "ledMask",
      cape: true,
      capeColor: "#1b2746",
    },
  },
  {
    id: "gunslinger",
    name: "Racalvin the Pirate King",
    // Real Meshy "King of Pirates" biped (24-bone rig) merged with its own
    // bundled animation set into one self-contained GLB via
    // scripts/src/merge-glb-anims.mjs. He is no longer the procedural box rig —
    // this is the exemplar character for the trainable special-weapon system.
    // Racalvin's art-forward already matches his heading, so no yaw offset.
    // (Was Math.PI, which faced him 180° from travel → moonwalk.)
    file: "models/racalvin.glb",
    scale: 1,
    // Locomotion roles pinned to the Meshy clip names; autoMapClips() back-fills
    // jump/death/hurt/block by fuzzy-matching the remaining clips.
    clips: {
      idle: "idle",
      walk: "walk",
      run: "run",
      attack: "thrust_slash",
    },
    // Signature slots point at his real native clips (driven through the generic
    // skill path now that the hardcoded pistol-kiter kit is gone — special-weapon
    // combat will be rebuilt on the trainable system).
    signatureSkills: [
      { label: "Quick Draw", clip: "draw_and_shoot_left", kind: "muzzle" },
      { label: "Cutlass Storm", clip: "double_blade_spin", kind: "nova" },
      { label: "Spartan Kick", clip: "spartan_kick", kind: "bolt" },
      { label: "Charged Slash", clip: "charged_upward_slash", kind: "muzzle" },
    ],
    handBone: "Hand",
    modelYaw: 0,
  },
  // karate-boss / Sensei intentionally removed from production cast.
  {
    id: "orc",
    name: "Brute",
    file: "models/orc.glb",
    scale: 1,
    clips: {
      idle: "idle",
      walk: "walk",
      run: "walk",
      attack: "attack",
      hurt: "hurt",
    },
    signatureSkills: [],
    handBone: "hand",
    // This rig's art-forward already points along +Z (unlike the others, which
    // need PI to face away). Leaving it at PI made the Brute face away from its
    // heading and "moonwalk" — feet stepping forward while the body slid back.
    modelYaw: 0,
  },
  {
    id: "sanji",
    name: "Striker",
    file: "models/sanji.glb",
    scale: 1,
    clips: {
      idle: "Normal Idol",
      walk: "Normal Walk",
      run: "Normal Walk",
      attack: "Diable Jambe",
    },
    signatureSkills: [
      // sig0 (Key 1): quick bolt-kick; sig1-3 are big fire abilities.
      { label: "Flanchet Shot", clip: "Flanchet Shot", kind: "bolt" },
      { label: "Launch Kick",   clip: "Have a Taste",  kind: "slam" },
      { label: "Flame Tornado", clip: "Diable Jambe",  kind: "slam" },
      { label: "Hover",         clip: "",              kind: "slam" },
    ],
    handBone: "hand",
    modelYaw: Math.PI,
    weaponless: true,
    meleeStyle: "kick",
    directionAssist: 60,
    dashRating: 40,
    // Fire-themed dive-in kick fighter. Combo + skills are pure data; the rig
    // plays its OWN native kick clips, layered with fire VFX + procedural body
    // motion. NOTE: this is a skinless, low-bone Sketchfab rig (bones named
    // Head_2/Body_8/RightArm_14...) — standard Mixamo FBX clips CANNOT be
    // retargeted onto it (disjoint bone names + different topology/rest pose, no
    // skeleton for SkeletonUtils), so every Striker action uses a native GLB clip
    // with a graceful fallback to the attack role. No `kickClips` — native only.
    kick: {
      fx: "fire",
      palette: { core: 0xfff1c0, flame: 0xff7a1e, ember: 0xff3b1e },
      combo: [
        // Hit 1 — bounce-up that keeps the struck target framed under the crosshair.
        // Opener plays the rig's NATIVE "Party Table Kick Course" clip (the low-bone
        // Sketchfab rig can't retarget the Mixamo FBX), resolved by the data-driven
        // stage-0 lookup; falls back to the attack role if missing.
        { clip: "Party Table Kick Course", damage: 16, reach: 1.8, bounce: 0.35, force: 0.5, radius: 1.9, lift: 1.2, hop: 4.5 },
        // Hit 2 — downward strike + flaming-foot bounce-away (self hop, push target off).
        { clip: "Have a Taste", damage: 22, reach: 1.6, bounce: 0.9, force: 1.0, radius: 2.0, hop: 5.5 },
        // Hit 3 — spinning fire-kick finisher + cone-flame burst.
        { clip: "Anti Matter Kick Course", damage: 34, reach: 2.2, bounce: 0.6, force: 1.4, radius: 2.6 },
      ],
      // Cooldowns mirror the Studio's STRIKER_SIG_CD baseline so the Striker plays
      // identically now that the sig handlers read cooldowns from this data.
      skills: [
        { behavior: "lunge", cooldown: 2.5, damage: 40, force: 1.0, radius: 2.4 },
        { behavior: "launcher", cooldown: 5.0, damage: 38, force: 0.4, radius: 2.6 },
        { behavior: "aerialProjectile", cooldown: 6.0, damage: 46, force: 1.0, radius: 2.6 },
        { behavior: "hover", cooldown: 7.0, damage: 0, force: 0, radius: 0 },
      ],
    },
  },
  {
    id: "tera-kasi",
    name: "Tera-Kasi",
    // Placeholder rig: reuses the Striker's GLB (its native kick clips drive hits
    // 2-3 + the signature poses). The distinct identity is the flip_kick.fbx combo
    // opener, the electric "chi" VFX theme, and snappier signature cooldowns.
    file: "models/sanji.glb",
    scale: 1,
    clips: {
      idle: "Normal Idol",
      walk: "Normal Walk",
      run: "Normal Walk",
      attack: "Diable Jambe",
    },
    signatureSkills: [
      // sig0 (Key 1): quick chi dive-kick; sig1-3 are the bigger thunder abilities.
      { label: "Chi Strike",     clip: "striker:flip_kick", kind: "bolt" },
      { label: "Thunder Rise",   clip: "striker:backflip",  kind: "nova" },
      { label: "Storm Cyclone",  clip: "Diable Jambe",      kind: "nova" },
      { label: "Levitate",       clip: "",                  kind: "nova" },
    ],
    handBone: "hand",
    modelYaw: Math.PI,
    weaponless: true,
    meleeStyle: "kick",
    directionAssist: 55,
    dashRating: 45,
    // Tera-kasi pulls in the reserved flip_kick.fbx as its combo opener (hit 0) and
    // themes every impact with crackling lightning (fx: "chi"). Hits 2-3 reuse the
    // shared rig's native kick clips; signature behaviour is the shared kick kit.
    kickClips: [
      { name: "striker:flip_kick", file: "anim/striker/flip_kick.fbx" },
      { name: "striker:backflip", file: "anim/striker/backflip.fbx" },
      { name: "striker:roll", file: "anim/striker/roll.fbx" },
    ],
    kick: {
      fx: "chi",
      // Electric chi palette: white-blue core, azure flame, deep-blue ember.
      palette: { core: 0xddf4ff, flame: 0x4fa8ff, ember: 0x2b6cff },
      combo: [
        // Hit 1 — the reserved flip-kick opener (FBX) that launches the target.
        { clip: "striker:flip_kick", damage: 18, reach: 1.9, bounce: 0.4, force: 0.5, radius: 1.9, lift: 1.2, hop: 4.5 },
        // Hit 2 — downward strike + bounce-away.
        { clip: "Have a Taste", damage: 22, reach: 1.6, bounce: 0.9, force: 1.0, radius: 2.0, hop: 5.5 },
        // Hit 3 — spinning finisher.
        { clip: "Anti Matter Kick Course", damage: 36, reach: 2.2, bounce: 0.6, force: 1.4, radius: 2.6 },
      ],
      // Snappier than the Striker — a fast, mobile lightning brawler.
      skills: [
        { behavior: "lunge", cooldown: 1.8, damage: 42, force: 1.0, radius: 2.4 },
        { behavior: "launcher", cooldown: 4.0, damage: 38, force: 0.4, radius: 2.6 },
        { behavior: "aerialProjectile", cooldown: 5.0, damage: 48, force: 1.0, radius: 2.6 },
        { behavior: "hover", cooldown: 6.0, damage: 0, force: 0, radius: 0 },
      ],
    },
  },
  {
    // Spellcaster built on the procedural Explorer rig + Arcane Staff. Its four
    // signature slots each cast one of the new model-driven projectile/spell VFX
    // (vfx-sandbox templates) via the generic signature path; the staff's F-skill
    // casts the 5th spell — Deploy Turret — so all five projectiles are castable
    // in core gameplay (it stays available in the Dressing Room VFX panel too).
    id: "archmage",
    name: "Archmage",
    file: "",
    scale: 1,
    clips: {
      idle: "idle",
      walk: "walk",
      run: "run",
      attack: "attack",
      jump: "jump",
      death: "death",
      hurt: "hit",
      block: "block",
    },
    signatureSkills: [
      { label: "Fire Dragon", clip: "castSpell", kind: "fireDragon" },
      { label: "Meteor Strike", clip: "magicArea", kind: "meteor" },
      { label: "Dark Blades", clip: "magicAttack", kind: "darkBlades" },
      { label: "Sword Volley", clip: "castSpell2", kind: "swordVolley" },
    ],
    fskillKind: "turret",
    handBone: "hand",
    modelYaw: 0,
    procedural: true,
    defaultWeapon: "staff",
    // Caster of bespoke GLB spells (fireDragon / meteor / darkBlades /
    // swordVolley): launch them from the casting hand's collider pose so live
    // combat matches the Dressing Room Skill Lab preview.
    colliderVfx: true,
  },
  {
    // Soul/void caster on the procedural Explorer rig + Arcane Staff. Unlike the
    // Archmage (generic projectile spells), the Soulbinder's four signature slots
    // are a bespoke kit driven by Studio.doArcaneSig (gated on `arcane` + staff):
    // 1 = soul-step backstep, 2 = release homing souls, 3 = void-jaunt (drop timed
    // soul-bombs then blink backward), 4 = soul-nova capstone.
    id: "soulbinder",
    name: "Soulbinder",
    file: "",
    scale: 1,
    clips: {
      idle: "idle",
      walk: "walk",
      run: "run",
      attack: "attack",
      jump: "jump",
      death: "death",
      hurt: "hit",
      block: "block",
    },
    // Clip field is the pose each slot falls back to; the arcane branch plays its
    // own clips. `kind` only drives the HUD slot color/icon.
    signatureSkills: [
      { label: "Soul Step", clip: "backJump", kind: "nova" },
      { label: "Soul Release", clip: "magicAttack", kind: "soul" },
      { label: "Void Jaunt", clip: "longBackJump", kind: "soul" },
      { label: "Soul Nova", clip: "magicArea", kind: "nova" },
    ],
    handBone: "hand",
    modelYaw: 0,
    procedural: true,
    defaultWeapon: "staff",
    // Procedural caster (Archmage's proven hand pose): the Soul Release fan + basic
    // staff swings emit from the casting hand's collider pose. Souls still home onto
    // their targets — only the launch origin moves to the real hand.
    colliderVfx: true,
    arcane: {
      backstep: 5.5,
      soulCount: 4,
      soulDamage: 26,
      soulRadius: 1.4,
      blinkDist: 7,
      bombCount: 3,
      bombDamage: 38,
      bombRadius: 2.6,
      bombDelay: 1.2,
      novaDamage: 30,
      novaRadius: 4.5,
    },
  },
  {
    id: "centurion",
    name: "Tank",
    file: "",
    scale: 1,
    clips: {
      idle: "idle",
      walk: "walk",
      run: "run",
      attack: "attack",
      jump: "jump",
      death: "death",
      hurt: "hit",
      block: "block",
    },
    // Clip field is the pose each slot falls back to; the tank branch in
    // Studio.useSkill (doTankSig) drives the real behaviour. `kind` only drives
    // the HUD slot colour/icon. LMB primary is the generic sword+shield combo.
    signatureSkills: [
      { label: "Shield Charge", clip: "dashAttack", kind: "slam" },
      { label: "Shield Bash", clip: "stab", kind: "thrust" },
      { label: "Blade Flurry", clip: "attack1", kind: "slash" },
      { label: "Super Cannon", clip: "skill", kind: "muzzle" },
    ],
    handBone: "hand",
    modelYaw: 0,
    procedural: true,
    // A procedural Explorer rig that spawns gunblade-in-hand using the shared
    // "sword" locomotion class (already a sword-and-shield stance).
    defaultWeapon: "gunblade",
    // Procedural rig (Archmage's proven hand pose): blade flurry + basic gunblade
    // swings + the weapon F-skill emit from the swinging hand's collider pose. The
    // Super Cannon already fires from the gunblade's tip (which tracks the swing).
    colliderVfx: true,
    // Slow, armoured bruiser: ~75% move speed, ~65% incoming damage, and a
    // sturdier guard (extra ~70% mitigation while blocking). Four bespoke
    // signature skills dispatched by Studio.doTankSig.
    tank: {
      moveSpeedMul: 0.75,
      damageTakenMul: 0.65,
      blockDamageMul: 0.7,
      chargeDistance: 7,
      chargeDamage: 34,
      chargeRadius: 2.6,
      bashDamage: 26,
      bashRadius: 2.2,
      flurryDamage: 16,
      flurryHits: 4,
      flurryRadius: 2.2,
      cannonDamage: 70,
      cannonRadius: 4.0,
      cannonRange: 26,
    },
  },
  // Lab-only licensed cast (Spider-Gwen / Iron Spider / Numbuh 1) removed from
  // production picker. Account heroes live on the Ethereal Falls campfire
  // (fleet / charactersgrudox) — never as a 24-prefab grudge6 grid.
];

/**
 * Production picker roster — lab demos, Sensei, ikkau, and the 24 grudge6
 * race×class prefabs are intentionally absent. Account characters come from
 * fleet / campfire slots, not this catalog dump.
 */
export const PLAYABLE_CHARACTERS: CharacterDef[] = CHARACTERS.filter((c) => {
  const id = c.id.toLowerCase();
  const name = c.name.toLowerCase();
  if (id === "karate-boss" || name === "sensei") return false;
  if (id.startsWith("grudge-")) return false;
  if (/ikkau|ikkaku/.test(id) || /ikkau|ikkaku/.test(name)) return false;
  return true;
});

export function getWeapon(id: string): WeaponDef {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}

/**
 * Resolve a weapon's full melee combat profile: its category hold-style default
 * (`arsenal/holdStyle.ts`) with the weapon's partial deviation merged over it.
 * Weapons declare only the fields that differ from their category standard.
 */
export function weaponCombat(id: string): WeaponCombat {
  return resolveCombat(getWeapon(id));
}

/**
 * Resolve a character def. Removed lab ids (Sensei, grudge-*, ikkau) fall back
 * to Explorer so fleet handoff never crashes the Danger Room.
 */
export function getCharacter(id: string): CharacterDef {
  const explorer = CHARACTERS.find((c) => c.id === "explorer") ?? CHARACTERS[0];
  if (!id) return explorer;
  if (/ikkau|ikkaku|karate-boss/i.test(id) || id.startsWith("grudge-")) return explorer;
  return CHARACTERS.find((c) => c.id === id) ?? explorer;
}
