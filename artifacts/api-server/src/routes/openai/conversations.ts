import { Router, type IRouter, type Response } from "express";
import { eq, and, asc, desc } from "drizzle-orm";
import { db, conversationsTable, messagesTable } from "@workspace/db";
import {
  CreateOpenaiConversationBody,
  ListOpenaiConversationsQueryParams,
} from "@workspace/api-zod";
import type { AuthedRequest } from "../../middlewares/requireAuth";

const router: IRouter = Router();

/** Serialize a conversation row into the API shape (dates as ISO strings). */
function toApiConversation(row: typeof conversationsTable.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    surface: row.surface,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Serialize a message row into the API shape (dates as ISO strings). */
function toApiMessage(row: typeof messagesTable.$inferSelect) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

// List the caller's own conversations, optionally filtered by surface.
router.get("/openai/conversations", async (req: AuthedRequest, res: Response) => {
  const parsed = ListOpenaiConversationsQueryParams.safeParse(req.query);
  const surface = parsed.success ? parsed.data.surface : undefined;
  const rows = await db
    .select()
    .from(conversationsTable)
    .where(
      surface
        ? and(
            eq(conversationsTable.ownerId, req.userId!),
            eq(conversationsTable.surface, surface),
          )
        : eq(conversationsTable.ownerId, req.userId!),
    )
    .orderBy(desc(conversationsTable.createdAt))
    .limit(200);
  res.json(rows.map(toApiConversation));
});

// Create a new conversation owned by the caller.
router.post("/openai/conversations", async (req: AuthedRequest, res: Response) => {
  const parsed = CreateOpenaiConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid conversation payload" });
    return;
  }
  const { title, surface } = parsed.data;
  const [row] = await db
    .insert(conversationsTable)
    .values({ ownerId: req.userId!, title, surface: surface ?? "editor" })
    .returning();
  res.status(201).json(toApiConversation(row));
});

// Get one of the caller's conversations with its messages.
router.get("/openai/conversations/:id", async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
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
  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(asc(messagesTable.createdAt));
  res.json({
    ...toApiConversation(convo),
    messages: messages.map(toApiMessage),
  });
});

// Delete one of the caller's conversations (messages cascade).
router.delete("/openai/conversations/:id", async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const deleted = await db
    .delete(conversationsTable)
    .where(
      and(
        eq(conversationsTable.id, id),
        eq(conversationsTable.ownerId, req.userId!),
      ),
    )
    .returning();
  if (deleted.length === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).end();
});

// List messages in one of the caller's conversations.
router.get(
  "/openai/conversations/:id/messages",
  async (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Confirm ownership before exposing any messages.
    const [convo] = await db
      .select({ id: conversationsTable.id })
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
    const rows = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, id))
      .orderBy(asc(messagesTable.createdAt));
    res.json(rows.map(toApiMessage));
  },
);

export default router;
