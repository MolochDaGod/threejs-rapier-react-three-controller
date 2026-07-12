/**
 * Client-side AI assistant contract. The whitelisted tool surface lives here in
 * the animator (colocated with the engines it drives) so the model can only ever
 * invoke real, existing editor setters — there is no server-side tool drift.
 *
 * Each `AiTool` is a JSON-schema function definition plus a synchronous
 * `execute` that runs the corresponding engine setter against the live scene and
 * returns a short human-readable result label for the UI chip.
 */

/** A whitelisted function the model may call, bound to a live engine setter. */
export interface AiTool {
  /** Function name exposed to the model (snake_case). */
  name: string;
  /** One-line description guiding when the model should call it. */
  description: string;
  /** JSON-schema object describing the call arguments. */
  parameters: Record<string, unknown>;
  /**
   * Run the tool against the live engine. Receives the model's parsed arguments;
   * returns a short label describing what happened (sync or async). Throw (or
   * reject) to surface a failure. Async tools (e.g. AI image generation) are
   * awaited by the assistant before the next turn.
   */
  execute: (args: Record<string, unknown>) => string | Promise<string>;
}

/** A tool call the model issued, as parsed from the stream. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

/** The outcome of executing one tool call, rendered as a chip in the UI. */
export interface ToolResult {
  name: string;
  label: string;
  ok: boolean;
}

/** A chat turn as rendered in the assistant panel. */
export interface AiMessage {
  role: "user" | "assistant";
  content: string;
  /** Tool-execution chips attached to an assistant turn. */
  tools?: ToolResult[];
}
