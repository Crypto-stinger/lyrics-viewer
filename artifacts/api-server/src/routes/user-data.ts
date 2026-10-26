import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, userDataTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router = Router();

// Loose runtime validation: the client owns the exact data shape (TS types
// in the hooks). Server only enforces "looks like sane JSON within size
// limits" so a buggy client can't blow out the row, and a hostile client
// can't store arbitrary blobs.
const MAX_BYTES = 256 * 1024; // 256 KB per slice; per-user dataset is tiny.

const jsonArraySchema = z.array(z.unknown()).max(2000);
const jsonObjectSchema = z.record(z.string(), z.unknown());

function withinSize(name: string, value: unknown): boolean {
  try {
    const size = JSON.stringify(value).length;
    if (size > MAX_BYTES) {
      logger.warn({ slice: name, size }, "user-data slice over size limit");
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const snapshotSchema = z.object({
  setlists: jsonArraySchema,
  setlistOverrides: jsonObjectSchema,
  songNotes: jsonObjectSchema,
  favorites: jsonArraySchema,
  songKeys: jsonObjectSchema,
});

type Snapshot = z.infer<typeof snapshotSchema>;

const EMPTY_SNAPSHOT: Snapshot = {
  setlists: [],
  setlistOverrides: {},
  songNotes: {},
  favorites: [],
  songKeys: {},
};

router.get("/me/data", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const rows = await db
    .select()
    .from(userDataTable)
    .where(eq(userDataTable.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return res.json(EMPTY_SNAPSHOT);
  }
  return res.json({
    setlists: row.setlists ?? [],
    setlistOverrides: row.setlistOverrides ?? {},
    songNotes: row.songNotes ?? {},
    favorites: row.favorites ?? [],
    songKeys: row.songKeys ?? {},
  });
});

router.put("/me/data", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const parsed = snapshotSchema.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ issues: parsed.error.issues }, "invalid user-data snapshot");
    return res.status(400).json({ error: "Invalid data shape" });
  }
  const snap = parsed.data;
  // Per-slice size guard so one runaway slice can't OOM the row.
  for (const [k, v] of Object.entries(snap)) {
    if (!withinSize(k, v)) {
      return res.status(413).json({ error: `Slice "${k}" exceeds size limit` });
    }
  }
  const now = new Date();
  await db
    .insert(userDataTable)
    .values({ userId, ...snap, updatedAt: now })
    .onConflictDoUpdate({
      target: userDataTable.userId,
      set: { ...snap, updatedAt: now },
    });
  return res.json(snap);
});

export default router;
