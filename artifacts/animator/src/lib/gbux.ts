/**
 * GBUX — the player's soft-currency balance, persisted to localStorage.
 *
 * Nothing grants or spends GBUX yet; every player starts with a fixed grant
 * so the badge/panel have a real number to show. When earn/spend mechanics
 * arrive they should route through {@link addGbux} so subscribers update.
 */
import { useSyncExternalStore } from "react";

const KEY = "gbux:balance:v1";

/** Starting grant for players with no persisted balance. */
export const GBUX_STARTING_BALANCE = 1000;

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of [...listeners]) fn();
}

/** Current balance (starting grant when unset/corrupt/unavailable). */
export function getGbux(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return GBUX_STARTING_BALANCE;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : GBUX_STARTING_BALANCE;
  } catch {
    return GBUX_STARTING_BALANCE;
  }
}

/** Set the balance (clamped to a non-negative integer; best-effort persist). */
export function setGbux(next: number): void {
  try {
    localStorage.setItem(KEY, String(Math.max(0, Math.floor(next))));
  } catch {
    /* storage blocked — balance just won't persist */
  }
  emit();
}

/** Adjust the balance by a delta (earning positive, spending negative). */
export function addGbux(delta: number): void {
  setGbux(getGbux() + delta);
}

export function subscribeGbux(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Live balance for React components. */
export function useGbux(): number {
  return useSyncExternalStore(subscribeGbux, getGbux);
}

export function formatGbux(n: number): string {
  return n.toLocaleString("en-US");
}
