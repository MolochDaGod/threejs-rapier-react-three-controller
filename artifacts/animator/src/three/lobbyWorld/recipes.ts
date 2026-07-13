import type { ItemId, InventorySlot } from "./types";

export interface Recipe {
  id: string;
  name: string;
  result: ItemId;
  qty: number;
  cost: { id: ItemId; qty: number }[];
  /** Shown in craft panel category. */
  tab: "basic" | "tools" | "build" | "combat";
}

export const RECIPES: Recipe[] = [
  { id: "planks", name: "Planks", result: "planks", qty: 4, cost: [{ id: "wood", qty: 1 }], tab: "basic" },
  { id: "sticks", name: "Sticks", result: "sticks", qty: 4, cost: [{ id: "planks", qty: 1 }], tab: "basic" },
  { id: "stone_brick", name: "Stone Brick", result: "stone_brick", qty: 1, cost: [{ id: "stone", qty: 2 }], tab: "basic" },
  { id: "torch", name: "Torch", result: "torch", qty: 4, cost: [{ id: "sticks", qty: 1 }, { id: "fiber", qty: 1 }], tab: "basic" },
  { id: "iron_ingot", name: "Iron Ingot", result: "iron_ingot", qty: 1, cost: [{ id: "ore", qty: 2 }], tab: "basic" },
  { id: "axe", name: "Axe", result: "axe", qty: 1, cost: [{ id: "sticks", qty: 2 }, { id: "wood", qty: 3 }], tab: "tools" },
  { id: "pickaxe", name: "Pickaxe", result: "pickaxe", qty: 1, cost: [{ id: "sticks", qty: 2 }, { id: "stone", qty: 3 }], tab: "tools" },
  { id: "sword", name: "Sword", result: "sword", qty: 1, cost: [{ id: "sticks", qty: 1 }, { id: "iron_ingot", qty: 2 }], tab: "combat" },
  { id: "shield", name: "Shield", result: "shield", qty: 1, cost: [{ id: "planks", qty: 4 }, { id: "iron_ingot", qty: 1 }], tab: "combat" },
  { id: "potion", name: "Health Potion", result: "potion", qty: 1, cost: [{ id: "fiber", qty: 3 }, { id: "meat", qty: 1 }], tab: "combat" },
  { id: "campfire", name: "Campfire", result: "campfire", qty: 1, cost: [{ id: "wood", qty: 4 }, { id: "stone", qty: 2 }], tab: "build" },
  { id: "workbench", name: "Workbench", result: "workbench", qty: 1, cost: [{ id: "planks", qty: 8 }], tab: "build" },
  { id: "wall", name: "Wall Block", result: "wall", qty: 4, cost: [{ id: "planks", qty: 2 }], tab: "build" },
  { id: "floor", name: "Floor Block", result: "floor", qty: 4, cost: [{ id: "stone_brick", qty: 1 }], tab: "build" },
];

export const VENDOR_STOCK: { id: ItemId; name: string; price: number; qty: number }[] = [
  { id: "potion", name: "Health Potion", price: 5, qty: 1 },
  { id: "torch", name: "Torch x4", price: 3, qty: 4 },
  { id: "iron_ingot", name: "Iron Ingot", price: 8, qty: 1 },
  { id: "sword", name: "Iron Sword", price: 25, qty: 1 },
  { id: "pickaxe", name: "Stone Pick", price: 12, qty: 1 },
  { id: "axe", name: "Wood Axe", price: 10, qty: 1 },
];

export function countItem(inv: InventorySlot[], id: ItemId): number {
  return inv.filter((s) => s.id === id).reduce((n, s) => n + s.qty, 0);
}

export function canCraft(inv: InventorySlot[], recipe: Recipe): boolean {
  return recipe.cost.every((c) => countItem(inv, c.id) >= c.qty);
}

/** Mutates a copy of inventory; returns new inventory or null if failed. */
export function applyCraft(inv: InventorySlot[], recipe: Recipe): InventorySlot[] | null {
  if (!canCraft(inv, recipe)) return null;
  let next = inv.map((s) => ({ ...s }));
  for (const c of recipe.cost) {
    let need = c.qty;
    next = next
      .map((s) => {
        if (s.id !== c.id || need <= 0) return s;
        const take = Math.min(s.qty, need);
        need -= take;
        return { ...s, qty: s.qty - take };
      })
      .filter((s) => s.qty > 0);
  }
  return addItem(next, recipe.result, recipe.qty);
}

export function addItem(inv: InventorySlot[], id: ItemId, qty: number): InventorySlot[] {
  const next = inv.map((s) => ({ ...s }));
  const existing = next.find((s) => s.id === id);
  if (existing) {
    existing.qty += qty;
    return next;
  }
  next.push({ id, qty });
  return next;
}

export function removeItem(inv: InventorySlot[], id: ItemId, qty: number): InventorySlot[] | null {
  if (countItem(inv, id) < qty) return null;
  let need = qty;
  return inv
    .map((s) => {
      if (s.id !== id || need <= 0) return { ...s };
      const take = Math.min(s.qty, need);
      need -= take;
      return { ...s, qty: s.qty - take };
    })
    .filter((s) => s.qty > 0);
}

export const ITEM_LABELS: Record<ItemId, string> = {
  wood: "Wood",
  stone: "Stone",
  fiber: "Fiber",
  ore: "Ore",
  meat: "Meat",
  hide: "Hide",
  planks: "Planks",
  sticks: "Sticks",
  stone_brick: "Stone Brick",
  iron_ingot: "Iron Ingot",
  torch: "Torch",
  pickaxe: "Pickaxe",
  axe: "Axe",
  sword: "Sword",
  shield: "Shield",
  campfire: "Campfire",
  workbench: "Workbench",
  wall: "Wall",
  floor: "Floor",
  coin: "Coin",
  potion: "Potion",
};
