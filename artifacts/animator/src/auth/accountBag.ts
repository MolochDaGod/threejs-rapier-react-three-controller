/**
 * Railway account bag bridge for Lobby World harvest.
 * Self-contained (no @workspace/fleet-client import — Vercel/Rollup safe).
 */

import type { InventorySlot, ItemId } from "../three/lobbyWorld/types";
import { apiUrl, readFleetToken } from "./fleetCore";

export type ResourceMap = Record<string, number>;

/** Island materials that belong on the shared account bag. */
const BAG_ITEMS: ItemId[] = [
  "wood",
  "stone",
  "fiber",
  "ore",
  "meat",
  "hide",
  "planks",
  "sticks",
  "stone_brick",
  "iron_ingot",
  "coin",
];

export function isBagItem(id: ItemId): boolean {
  return BAG_ITEMS.includes(id);
}

export async function fetchAccountResources(token?: string | null): Promise<ResourceMap> {
  const t = token !== undefined ? token : readFleetToken();
  if (!t) return {};
  try {
    const res = await fetch(apiUrl("/api/account/resources"), {
      headers: { Authorization: `Bearer ${t}`, Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { resources?: ResourceMap };
    return data.resources && typeof data.resources === "object" ? data.resources : {};
  } catch {
    return {};
  }
}

export async function batchAddAccountResources(
  items: { resourceId: string; amount: number }[],
  token?: string | null,
): Promise<boolean> {
  const t = token !== undefined ? token : readFleetToken();
  if (!t || !items.length) return false;
  const clean = items
    .filter((i) => i.resourceId && i.amount > 0)
    .map((i) => ({ resourceId: i.resourceId, amount: Math.floor(i.amount) }))
    .slice(0, 100);
  if (!clean.length) return false;
  try {
    const res = await fetch(apiUrl("/api/account/resources/batch"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ items: clean }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Debounced harvest queue → Railway account bag. */
export class AccountBagSync {
  private queue = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private token: string | null = null;
  private delayMs: number;
  onFlush: ((ok: boolean, items: { resourceId: string; amount: number }[]) => void) | null =
    null;

  constructor(opts?: { delayMs?: number; token?: string | null }) {
    this.delayMs = opts?.delayMs ?? 1500;
    this.token = opts?.token ?? null;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  enqueue(resourceId: string, amount: number) {
    if (!resourceId || amount <= 0) return;
    this.queue.set(resourceId, (this.queue.get(resourceId) || 0) + amount);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  async flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.queue.size) return true;
    const items = [...this.queue.entries()].map(([resourceId, amount]) => ({
      resourceId,
      amount,
    }));
    this.queue.clear();
    const ok = await batchAddAccountResources(items, this.token);
    this.onFlush?.(ok, items);
    if (!ok) {
      for (const i of items) this.enqueue(i.resourceId, i.amount);
    }
    return ok;
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    void this.flush();
  }
}

/** Merge Railway resources into local inventory slots. */
export function mergeResourcesIntoInventory(
  inv: InventorySlot[],
  resources: ResourceMap,
): InventorySlot[] {
  const map = new Map<ItemId, number>();
  for (const s of inv) map.set(s.id, s.qty);
  for (const [k, v] of Object.entries(resources)) {
    if (!BAG_ITEMS.includes(k as ItemId)) continue;
    if (typeof v !== "number" || v <= 0) continue;
    const id = k as ItemId;
    map.set(id, Math.max(map.get(id) || 0, Math.floor(v)));
  }
  return [...map.entries()].map(([id, qty]) => ({ id, qty }));
}

/** Pull account bag into inventory (authenticated only). */
export async function hydrateInventoryFromAccount(
  inv: InventorySlot[],
): Promise<{ inv: InventorySlot[]; ok: boolean; resources: ResourceMap }> {
  const token = readFleetToken();
  if (!token) return { inv, ok: false, resources: {} };
  const resources = await fetchAccountResources(token);
  if (!Object.keys(resources).length) return { inv, ok: true, resources };
  return { inv: mergeResourcesIntoInventory(inv, resources), ok: true, resources };
}

export function createHarvestBagSync(): AccountBagSync {
  return new AccountBagSync({ token: readFleetToken(), delayMs: 1200 });
}
