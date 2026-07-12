/**
 * Manual SSE client for the assistant's streaming endpoint. Orval cannot
 * generate a hook for a `text/event-stream` response, so we consume it with
 * `fetch` + `ReadableStream`. The conversation/message CRUD calls use the
 * generated client functions.
 *
 * The API is mounted at `/api` by the shared proxy regardless of the animator's
 * base path, so a root-relative `/api/...` URL is correct in dev and production.
 */
import type { AiTool, ToolCall } from "./types";

export interface StreamHandlers {
  /** A streamed natural-language text delta. */
  onText: (delta: string) => void;
  /** The single batch of tool calls the model issued this turn (awaited). */
  onToolCalls: (calls: ToolCall[]) => void | Promise<void>;
  /** A mid-stream server-side error event. */
  onError: (message: string) => void;
  /** The stream finished normally. */
  onDone: () => void;
}

/**
 * Result of a stream attempt. `not_found` means the conversation no longer
 * exists server-side (so the caller can transparently start a fresh one);
 * `failed` is a transport/HTTP failure; `ok` is a normal completion (which may
 * still have surfaced a mid-stream error via `onError`).
 */
export type StreamOutcome = "ok" | "not_found" | "failed";

/** Map our client tool registry into OpenAI function-tool definitions. */
function toToolDefs(tools: AiTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Send a user message and stream the assistant response. Resolves when the
 * stream ends (after invoking the relevant handlers along the way).
 */
export async function streamAssistant(
  conversationId: number,
  body: { content: string; system: string; tools: AiTool[] },
  handlers: StreamHandlers,
  signal?: AbortSignal,
  getToken?: () => Promise<string | null>,
): Promise<StreamOutcome> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // These endpoints require auth; attach the Clerk bearer token the same way the
  // generated API client does (the manual SSE fetch bypasses that client).
  if (getToken) {
    try {
      const token = await getToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {
      // Fall through unauthenticated; the server will reject with 401.
    }
  }

  let res: Response;
  try {
    res = await fetch(`/api/openai/conversations/${conversationId}/messages`, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        content: body.content,
        system: body.system,
        tools: toToolDefs(body.tools),
      }),
      signal,
    });
  } catch {
    // Aborted (unmount/surface change) or network failure.
    return signal?.aborted ? "ok" : "failed";
  }

  if (res.status === 404) return "not_found";
  if (!res.ok || !res.body) return "failed";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      // Aborted or network drop — treat as a clean end of stream.
      break;
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    // SSE events are separated by a blank line; keep the trailing partial.
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const line = evt.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let parsed: {
        content?: string;
        toolCalls?: ToolCall[];
        error?: string;
        done?: boolean;
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (parsed.content) handlers.onText(parsed.content);
      else if (parsed.toolCalls) await handlers.onToolCalls(parsed.toolCalls);
      else if (parsed.error) handlers.onError(parsed.error);
      else if (parsed.done) handlers.onDone();
    }
  }

  return "ok";
}
