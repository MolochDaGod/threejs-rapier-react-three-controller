/**
 * Per-surface assistant registry.
 *
 * The unified app shell hosts ONE global AI companion dock. Most surfaces are
 * owned by `App` (it knows the Danger Room tools/prompt), but a few modes own
 * their own live engine — the Dressing Room (Scene Editor) builds tools bound to
 * an engine ref it alone holds. Rather than lifting that engine into `App`, a
 * mode can register its assistant config here while mounted; the shell prefers a
 * child-registered config over the base config `App` passes for the active mode.
 */
import { createContext, useContext, useEffect, type DependencyList } from "react";
import type { AiTool } from "./types";

/** Everything the global AI dock needs to drive one surface's assistant. */
export interface AssistantConfig {
  /** Stable surface id — scopes the persisted conversation. */
  surface: string;
  /** Header title. */
  title: string;
  /** Live tool registry bound to the surface's engine (may be empty). */
  tools: AiTool[];
  /** Returns the full system prompt (with fresh context) per turn. */
  getSystemPrompt: () => string;
  /** One-line input placeholder. */
  placeholder?: string;
}

interface AssistantSurfaceApi {
  /** Register (or clear with `null`) the active surface's assistant config. */
  set: (config: AssistantConfig | null) => void;
}

const Ctx = createContext<AssistantSurfaceApi | null>(null);

export const AssistantSurfaceContext = Ctx;

/**
 * Register an assistant config for the lifetime of the calling component. Pass
 * `deps` exactly as you would to `useEffect` so the config refreshes when its
 * inputs change. Clears the registration on unmount so the shell falls back to
 * the mode's base config.
 */
export function useRegisterAssistant(config: AssistantConfig | null, deps: DependencyList): void {
  const api = useContext(Ctx);
  useEffect(() => {
    api?.set(config);
    return () => api?.set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
