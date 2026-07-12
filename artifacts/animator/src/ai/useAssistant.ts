/**
 * Conversation lifecycle + streaming orchestration for the assistant.
 *
 * - One conversation per browser per surface, id cached in localStorage so the
 *   thread survives reloads. On mount we re-load that conversation's messages;
 *   if it was deleted server-side we transparently start a new one.
 * - Sending streams assistant text, then executes any tool calls against the
 *   live engine, attaching result chips to the turn.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  createOpenaiConversation,
  getOpenaiConversation,
  deleteOpenaiConversation,
} from "@workspace/api-client-react";
import { streamAssistant } from "./aiClient";
import type { AiMessage, AiTool, ToolCall, ToolResult } from "./types";

function storageKey(surface: string): string {
  return `animator.ai.conversation.${surface}`;
}

export interface UseAssistantArgs {
  /** Stable surface id (e.g. "editor" or "danger") — scopes the conversation. */
  surface: string;
  /** Live tool registry bound to the engine. */
  tools: AiTool[];
  /** Returns the full system prompt (with fresh scene context) for each turn. */
  getSystemPrompt: () => string;
}

export interface UseAssistant {
  messages: AiMessage[];
  streaming: boolean;
  ready: boolean;
  send: (text: string) => void;
  clear: () => void;
}

export function useAssistant({ surface, tools, getSystemPrompt }: UseAssistantArgs): UseAssistant {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const convoIdRef = useRef<number | null>(null);
  // Synchronous single-flight lock: `streaming` state lags a render behind, so a
  // ref guards against overlapping sends fired within the same tick.
  const inFlightRef = useRef(false);
  // Aborts the active stream on unmount / surface change.
  const abortRef = useRef<AbortController | null>(null);

  // Clerk bearer token for the manual SSE fetch (the generated client attaches
  // it automatically, but streamAssistant uses a raw fetch).
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // Keep the latest tools/prompt accessor without re-binding send().
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const promptRef = useRef(getSystemPrompt);
  promptRef.current = getSystemPrompt;

  // Load (or lazily create on first send) the per-surface conversation.
  useEffect(() => {
    let cancelled = false;
    const stored = Number(localStorage.getItem(storageKey(surface)) ?? "");
    if (!Number.isInteger(stored) || stored <= 0) {
      setReady(true);
      return;
    }
    (async () => {
      try {
        const convo = await getOpenaiConversation(stored);
        if (cancelled) return;
        convoIdRef.current = convo.id;
        setMessages(
          convo.messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        );
      } catch {
        // Conversation was deleted server-side; drop the stale id.
        if (!cancelled) localStorage.removeItem(storageKey(surface));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [surface]);

  // Abort any in-flight stream when the component unmounts or the surface flips.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = false;
    };
  }, [surface]);

  const ensureConversation = useCallback(async (): Promise<number> => {
    if (convoIdRef.current != null) return convoIdRef.current;
    const convo = await createOpenaiConversation({ surface, title: `${surface} assistant` });
    convoIdRef.current = convo.id;
    localStorage.setItem(storageKey(surface), String(convo.id));
    return convo.id;
  }, [surface]);

  const runToolCalls = useCallback(async (calls: ToolCall[]): Promise<ToolResult[]> => {
    const results: ToolResult[] = [];
    for (const call of calls) {
      const tool = toolsRef.current.find((t) => t.name === call.name);
      if (!tool) {
        results.push({ name: call.name, label: "Unknown command", ok: false });
        continue;
      }
      let args: Record<string, unknown> = {};
      if (typeof call.arguments === "string") {
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          args = {};
        }
      } else if (call.arguments && typeof call.arguments === "object") {
        args = call.arguments as Record<string, unknown>;
      }
      try {
        // Tools may be async (e.g. AI pattern generation): await each so the
        // result chip reflects the real outcome and turns run sequentially.
        const label = await tool.execute(args);
        results.push({ name: call.name, label, ok: true });
      } catch (err) {
        results.push({
          name: call.name,
          label: err instanceof Error ? err.message : "Failed",
          ok: false,
        });
      }
    }
    return results;
  }, []);

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      // Synchronous lock beats the lagging `streaming` state for double-submits.
      if (!content || inFlightRef.current) return;
      inFlightRef.current = true;
      setStreaming(true);
      // Optimistically render the user turn + an empty assistant turn to fill.
      setMessages((prev) => [
        ...prev,
        { role: "user", content },
        { role: "assistant", content: "" },
      ]);

      const appendText = (delta: string) =>
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + delta };
          }
          return next;
        });

      const attachTools = (results: ToolResult[]) =>
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, tools: [...(last.tools ?? []), ...results] };
          }
          return next;
        });

      const controller = new AbortController();
      abortRef.current = controller;

      const runOnce = async (retried: boolean): Promise<void> => {
        let conversationId: number;
        try {
          conversationId = await ensureConversation();
        } catch {
          appendText("I couldn't start a conversation. Please try again.");
          return;
        }
        const outcome = await streamAssistant(
          conversationId,
          { content, system: promptRef.current(), tools: toolsRef.current },
          {
            onText: appendText,
            onToolCalls: async (calls) => attachTools(await runToolCalls(calls)),
            onError: (message) => appendText(message ? `\n${message}` : ""),
            onDone: () => {},
          },
          controller.signal,
          () => getTokenRef.current(),
        );
        if (controller.signal.aborted) return;
        if (outcome === "not_found" && !retried) {
          // Conversation vanished server-side — drop the stale id and start fresh.
          convoIdRef.current = null;
          localStorage.removeItem(storageKey(surface));
          await runOnce(true);
          return;
        }
        if (outcome !== "ok") {
          appendText("The assistant request failed. Please try again.");
        }
      };

      (async () => {
        try {
          await runOnce(false);
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
          inFlightRef.current = false;
          if (!controller.signal.aborted) setStreaming(false);
        }
      })();
    },
    [ensureConversation, runToolCalls, surface],
  );

  const clear = useCallback(() => {
    const id = convoIdRef.current;
    convoIdRef.current = null;
    localStorage.removeItem(storageKey(surface));
    setMessages([]);
    if (id != null) void deleteOpenaiConversation(id).catch(() => {});
  }, [surface]);

  return { messages, streaming, ready, send, clear };
}
