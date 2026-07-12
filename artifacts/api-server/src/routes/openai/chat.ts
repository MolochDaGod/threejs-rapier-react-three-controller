import { Router, type IRouter, type Response } from "express";
import { eq, and, asc } from "drizzle-orm";
import { db, conversationsTable, messagesTable } from "@workspace/db";
import { SendOpenaiMessageBody } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { AuthedRequest } from "../../middlewares/requireAuth";

const router: IRouter = Router();

/** Accumulated streaming tool call, keyed by its delta index. */
interface PartialToolCall {
  id: string;
  name: string;
  arguments: string;
}

// Send a user message and stream the assistant response (text deltas, then
// any tool calls, then a done signal) over SSE. The model can issue whitelisted
// tool calls that the client executes against the live editor engine.
router.post(
  "/openai/conversations/:id/messages",
  async (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const parsed = SendOpenaiMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid message payload" });
      return;
    }
    const { content, system, tools } = parsed.data;

    const [convo] = await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.id, id),
          eq(conversationsTable.ownerId, req.userId!),
        ),
      )
      .limit(1);
    if (!convo) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Persist the user turn before building the prompt so it is part of history.
    await db
      .insert(messagesTable)
      .values({ conversationId: id, role: "user", content });

    const history = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, id))
      .orderBy(asc(messagesTable.createdAt));

    const chatMessages: ChatCompletionMessageParam[] = [];
    if (system) {
      chatMessages.push({ role: "system", content: system });
    }
    for (const m of history) {
      if (m.role === "user") {
        chatMessages.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        chatMessages.push({ role: "assistant", content: m.content });
      }
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";
    const partialToolCalls = new Map<number, PartialToolCall>();

    try {
      const stream = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 8192,
        messages: chatMessages,
        stream: true,
        ...(tools && tools.length > 0
          ? {
              tools: tools as unknown as ChatCompletionTool[],
              tool_choice: "auto" as const,
            }
          : {}),
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullResponse += delta.content;
          res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
        }

        for (const tc of delta.tool_calls ?? []) {
          const existing = partialToolCalls.get(tc.index) ?? {
            id: "",
            name: "",
            arguments: "",
          };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments)
            existing.arguments += tc.function.arguments;
          partialToolCalls.set(tc.index, existing);
        }
      }

      // Emit collected tool calls (arguments parsed to objects) for the client.
      if (partialToolCalls.size > 0) {
        const toolCalls = [...partialToolCalls.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, tc]) => {
            let args: unknown = {};
            try {
              args = tc.arguments ? JSON.parse(tc.arguments) : {};
            } catch {
              args = {};
            }
            return { id: tc.id, name: tc.name, arguments: args };
          });
        res.write(`data: ${JSON.stringify({ toolCalls })}\n\n`);
      }

      // Persist the assistant's natural-language turn so reloads stay readable.
      if (fullResponse.trim().length > 0) {
        await db.insert(messagesTable).values({
          conversationId: id,
          role: "assistant",
          content: fullResponse,
        });
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err) {
      req.log.error({ err }, "AI assistant stream failed");
      res.write(
        `data: ${JSON.stringify({ error: "The assistant request failed." })}\n\n`,
      );
      res.end();
    }
  },
);

export default router;
