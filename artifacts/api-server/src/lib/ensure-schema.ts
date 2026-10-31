import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Create the database table on a fresh database (e.g. a new Render Postgres).
 * Safe to run on every start: it does nothing if the table already exists.
 * Must match lib/db/src/schema/user-data.ts.
 */
export async function ensureSchema(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_data (
        user_id text PRIMARY KEY,
        setlists jsonb NOT NULL DEFAULT '[]'::jsonb,
        setlist_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        song_notes jsonb NOT NULL DEFAULT '{}'::jsonb,
        favorites jsonb NOT NULL DEFAULT '[]'::jsonb,
        song_keys jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    logger.error({ err }, "Could not check/create the database table");
  }
}
