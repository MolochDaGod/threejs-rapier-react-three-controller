import { pgTable, text, serial, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Gallery posts: authored Danger Room content (voxel dungeons/arenas and Scene
 * Editor scenes) that signed-in players publish so others can browse and play
 * them in multiplayer rooms.
 *
 * `payload` reuses the app's existing serialized formats verbatim (a `VoxelMap`
 * JSON for voxel maps/dungeons, the Scene Editor JSON for scenes) so posting is
 * just "store what the editor already serializes".
 */
export const postsTable = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    /** "scene" (Scene Editor) or "dungeon" (Voxel Editor map/dungeon). */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    /** Clerk user id of the owner. */
    ownerId: text("owner_id").notNull(),
    /** Display name of the author at post time. */
    authorName: text("author_name").notNull(),
    /** Serialized editor content (VoxelMap JSON or Scene JSON). */
    payload: jsonb("payload").notNull(),
    /** When false the post is only visible to its owner. */
    isPublic: boolean("is_public").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("posts_owner_idx").on(t.ownerId),
    index("posts_public_idx").on(t.isPublic),
  ],
);

export const insertPostSchema = createInsertSchema(postsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;
