import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-user "snapshot" of all the singer's personal data:
 *   - setlists (with songs)
 *   - setlist overrides (per-gig stage versions)
 *   - song notes (capo / tempo / free-form notes per song, globally)
 *   - favourites
 *   - song keys (preferred key per song, globally)
 *
 * Deliberately stored as five JSONB columns on a single row keyed by Clerk
 * userId. Keeping the shape this loose lets the client evolve its data
 * structures (adding new override fields, new song-notes properties, etc.)
 * without DB migrations. Zod validation on the server ensures the columns
 * stay JSON-shaped and within reasonable size limits.
 *
 * Per-user dataset is small (KBs) and we read/write whole slices, so a
 * single-row design is fine and keeps the API trivial. If a singer ever
 * accumulates thousands of setlists this can be split into proper relational
 * tables; we're nowhere near that.
 */
export const userDataTable = pgTable("user_data", {
  userId: text("user_id").primaryKey(),
  setlists: jsonb("setlists").notNull().default([]),
  setlistOverrides: jsonb("setlist_overrides").notNull().default({}),
  songNotes: jsonb("song_notes").notNull().default({}),
  favorites: jsonb("favorites").notNull().default([]),
  songKeys: jsonb("song_keys").notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UserDataRow = typeof userDataTable.$inferSelect;
