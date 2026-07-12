import { Router, type IRouter, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, postsTable } from "@workspace/db";
import { CreatePostBody, ListPostsQueryParams } from "@workspace/api-zod";
import {
  requireAuth,
  resolveDisplayName,
  type AuthedRequest,
} from "../middlewares/requireAuth";

const router: IRouter = Router();

/** Serialize a DB row into the API `Post` shape (dates as ISO strings). */
function toApiPost(row: typeof postsTable.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    ownerId: row.ownerId,
    authorName: row.authorName,
    payload: row.payload,
    isPublic: row.isPublic,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// List the public gallery, optionally filtered by kind.
router.get("/posts", async (req, res: Response) => {
  const parsed = ListPostsQueryParams.safeParse(req.query);
  const kind = parsed.success ? parsed.data.kind : undefined;
  const where = kind
    ? and(eq(postsTable.isPublic, true), eq(postsTable.kind, kind))
    : eq(postsTable.isPublic, true);
  const rows = await db
    .select()
    .from(postsTable)
    .where(where)
    .orderBy(desc(postsTable.createdAt))
    .limit(200);
  res.json(rows.map(toApiPost));
});

// List the authenticated user's own posts (public and private).
router.get("/posts/mine", requireAuth, async (req: AuthedRequest, res: Response) => {
  const rows = await db
    .select()
    .from(postsTable)
    .where(eq(postsTable.ownerId, req.userId!))
    .orderBy(desc(postsTable.createdAt))
    .limit(200);
  res.json(rows.map(toApiPost));
});

// Fetch a single post by id.
router.get("/posts/:id", async (req, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [row] = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(toApiPost(row));
});

// Publish a post owned by the authenticated user.
router.post("/posts", requireAuth, async (req: AuthedRequest, res: Response) => {
  const parsed = CreatePostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid post payload" });
    return;
  }
  const { kind, name, payload, isPublic } = parsed.data;
  const authorName = await resolveDisplayName(req.userId!);
  const [row] = await db
    .insert(postsTable)
    .values({
      kind,
      name,
      ownerId: req.userId!,
      authorName,
      payload: payload as unknown,
      isPublic: isPublic ?? true,
    })
    .returning();
  res.status(201).json(toApiPost(row));
});

export default router;
