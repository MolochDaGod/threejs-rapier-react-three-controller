import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * AI assistant conversations. Each chat thread for the in-editor "AI admin
 * master & editor" assistant is one conversation; its turns live in `messages`.
 *
 * `surface` records which editor UI owns the thread ("editor" for the Scene
 * Editor's Inspector chat, "danger" for the Danger Room chat) so each surface
 * keeps its own persisted history.
 */
export const conversationsTable = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    /** Clerk user id of the owner; conversations are private to this user. */
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    surface: text("surface").notNull().default("editor"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("conversations_owner_idx").on(t.ownerId),
    index("conversations_surface_idx").on(t.surface),
  ],
);

export const insertConversationSchema = createInsertSchema(conversationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationsTable.$inferSelect;
