/**
 * Harvest tools SSOT — aligned with Open `game/inventory/harvestTools.ts`.
 * Lab host: Danger Room wallet craft (wood/stone/fiber/ore) without full bag UI.
 * Combat loadout stays separate; harvest tools are harvest stance only.
 */

export type ProfessionId =
  | "logging"
  | "mining"
  | "gathering"
  | "skinning"
  | "fishing"
  | "farming";

export type HarvestToolDef = {
  id: string;
  name: string;
  profession: ProfessionId;
  /** Activity tool id used by Studio radial / harvest mode */
  activityTool: string;
  description: string;
  craftCost: Array<{ templateId: string; qty: number; name: string }>;
  icon: string;
  basePower: number;
  powerPerLevel: number;
  /** Resource kinds this tool stages efficiently. */
  harvestKinds: Array<"wood" | "stone" | "fiber" | "wildlife">;
};

export const HARVEST_TOOLS: HarvestToolDef[] = [
  {
    id: "tool_hatchet",
    name: "Hatchet",
    profession: "logging",
    activityTool: "axe",
    description: "Chop trees. Logging power.",
    craftCost: [
      { templateId: "wood", qty: 4, name: "Wood" },
      { templateId: "stone", qty: 2, name: "Stone" },
    ],
    icon: "https://assets.grudge-studio.com/game-assets/icons/weapons_full/Axe_01.png",
    basePower: 12,
    powerPerLevel: 2,
    harvestKinds: ["wood"],
  },
  {
    id: "tool_pickaxe",
    name: "Pickaxe",
    profession: "mining",
    activityTool: "pick",
    description: "Break rock / ore.",
    craftCost: [
      { templateId: "wood", qty: 3, name: "Wood" },
      { templateId: "stone", qty: 5, name: "Stone" },
    ],
    icon: "https://assets.grudge-studio.com/game-assets/icons/professions/miner_profession_game_icon.png",
    basePower: 12,
    powerPerLevel: 2,
    harvestKinds: ["stone"],
  },
  {
    id: "tool_sickle",
    name: "Sickle",
    profession: "gathering",
    activityTool: "sickle",
    description: "Gather fiber / herbs.",
    craftCost: [
      { templateId: "wood", qty: 2, name: "Wood" },
      { templateId: "fiber", qty: 3, name: "Fiber" },
    ],
    icon: "https://assets.grudge-studio.com/game-assets/icons/professions/forester_profession_game_icon.png",
    basePower: 8,
    powerPerLevel: 1.5,
    harvestKinds: ["fiber", "wood"],
  },
  {
    id: "tool_skinning_knife",
    name: "Skinning Knife",
    profession: "skinning",
    activityTool: "knife",
    description: "Butcher wildlife (KeyN still works).",
    craftCost: [
      { templateId: "wood", qty: 2, name: "Wood" },
      { templateId: "ore", qty: 1, name: "Ore" },
    ],
    icon: "https://assets.grudge-studio.com/game-assets/icons/weapons_full/Dagger_01.png",
    basePower: 9,
    powerPerLevel: 1.8,
    harvestKinds: ["wildlife"],
  },
];

export type ProfessionLevels = Partial<Record<ProfessionId, number>>;

export type CraftedToolsState = {
  crafted: Record<string, number>;
  activeToolId: string | null;
  updatedAt: number;
};

const STORAGE_KEY = "grudge.danger.harvestTools.v1";

export function loadCraftedTools(): CraftedToolsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { crafted: {}, activeToolId: null, updatedAt: 0 };
    const j = JSON.parse(raw) as CraftedToolsState;
    return {
      crafted: j.crafted ?? {},
      activeToolId: j.activeToolId ?? null,
      updatedAt: j.updatedAt ?? 0,
    };
  } catch {
    return { crafted: {}, activeToolId: null, updatedAt: 0 };
  }
}

export function saveCraftedTools(state: CraftedToolsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

export function getHarvestTool(toolId: string): HarvestToolDef | undefined {
  return HARVEST_TOOLS.find((t) => t.id === toolId);
}

export function toolByActivity(activityTool: string): HarvestToolDef | undefined {
  return HARVEST_TOOLS.find((t) => t.activityTool === activityTool);
}

export function toolPower(tool: HarvestToolDef, professions: ProfessionLevels = {}): number {
  const lv = Math.max(1, Math.min(100, Math.floor(professions[tool.profession] ?? 1)));
  return Math.round(tool.basePower + tool.powerPerLevel * (lv - 1));
}

/** Normalize Open / lab activity tool ids. */
export function normalizeHarvestTool(id?: string): string {
  const t = String(id || "any").toLowerCase();
  if (t === "hatchet" || t === "chop" || t === "logging") return "axe";
  if (t === "pickaxe" || t === "mining" || t === "ore") return "pick";
  if (t === "gather" || t === "herb") return "sickle";
  if (t === "skin" || t === "butcher") return "knife";
  return t;
}

/** Damage multiplier vs harvest kind for the equipped activity tool. */
export function harvestMatchMul(
  activityTool: string,
  kind: "wood" | "stone",
): { mul: number; matched: boolean; wrongTool: boolean } {
  const t = normalizeHarvestTool(activityTool);
  if (kind === "wood") {
    if (t === "axe") return { mul: 1.15, matched: true, wrongTool: false };
    if (t === "sickle") return { mul: 0.55, matched: false, wrongTool: false };
    if (t === "pick" || t === "knife") return { mul: 0.2, matched: false, wrongTool: true };
    return { mul: 0.35, matched: false, wrongTool: true };
  }
  // stone
  if (t === "pick") return { mul: 1.15, matched: true, wrongTool: false };
  if (t === "axe") return { mul: 0.25, matched: false, wrongTool: true };
  return { mul: 0.2, matched: false, wrongTool: true };
}

export type LabWallet = { wood: number; stone: number; fiber: number; ore: number };

export function canCraftFromWallet(tool: HarvestToolDef, wallet: LabWallet): boolean {
  for (const c of tool.craftCost) {
    const k = c.templateId as keyof LabWallet;
    if ((wallet[k] ?? 0) < c.qty) return false;
  }
  return true;
}

export function deductCraftCost(tool: HarvestToolDef, wallet: LabWallet): LabWallet {
  const next = { ...wallet };
  for (const c of tool.craftCost) {
    const k = c.templateId as keyof LabWallet;
    next[k] = Math.max(0, (next[k] ?? 0) - c.qty);
  }
  return next;
}
