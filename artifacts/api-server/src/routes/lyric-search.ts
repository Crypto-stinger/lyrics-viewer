import { Router, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";

const router = Router();

// Simple per-IP rate limiter: 30 requests / 5 min. Higher than the audio
// fingerprint endpoint because typing snippets is cheap and users may try
// several lines before getting a confident match.
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 30;
const rateBuckets = new Map<string, number[]>();

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown").toString();
  const now = Date.now();
  const bucket = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (bucket.length >= RATE_MAX) {
    res.status(429).json({
      success: false,
      message: "Too many lyric searches. Please wait a few minutes and try again.",
    });
    return;
  }
  bucket.push(now);
  rateBuckets.set(ip, bucket);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) rateBuckets.delete(k);
    }
  }
  next();
}

interface GeniusSearchResponse {
  response?: {
    hits?: Array<{
      type?: string;
      result?: {
        title?: string;
        primary_artist?: { name?: string };
        full_title?: string;
      };
    }>;
  };
}

interface LrcLibGetResponse {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

interface Candidate {
  title: string;
  artist: string;
  hasSynced: boolean;
  hasPlain: boolean;
}

/** Strip noisy parenthetical/bracketed suffixes Genius often appends to track
 *  titles ("(Remastered 2009)", "[feat. X]") so LRCLIB lookup has a better
 *  chance of matching. We keep the original around for display. */
function cleanTitle(t: string): string {
  return t
    .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, " ")
    .replace(/\s*-\s*(remaster(ed)?|live|acoustic|radio edit).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchGenius(query: string, token: string): Promise<Array<{ title: string; artist: string }>> {
  const url = `https://api.genius.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Genius search HTTP ${res.status}`);
  }
  const data = (await res.json()) as GeniusSearchResponse;
  const hits = data.response?.hits ?? [];
  const out: Array<{ title: string; artist: string }> = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (h.type && h.type !== "song") continue;
    const title = h.result?.title?.trim();
    const artist = h.result?.primary_artist?.name?.trim();
    if (!title || !artist) continue;
    const key = `${artist.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, artist });
    if (out.length >= 10) break;
  }
  return out;
}

async function checkLrclib(artist: string, title: string): Promise<{ hasSynced: boolean; hasPlain: boolean }> {
  const cleaned = cleanTitle(title);
  const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(cleaned)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { hasSynced: false, hasPlain: false };
    const data = (await res.json()) as LrcLibGetResponse;
    return {
      hasSynced: typeof data.syncedLyrics === "string" && data.syncedLyrics.trim().length > 0,
      hasPlain: typeof data.plainLyrics === "string" && data.plainLyrics.trim().length > 0,
    };
  } catch {
    return { hasSynced: false, hasPlain: false };
  }
}

router.post("/lyric-search", rateLimit, async (req, res) => {
  const log = req.log;
  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (!token) {
    logger.warn("GENIUS_ACCESS_TOKEN not configured");
    return res.status(503).json({ success: false, message: "Lyric search is not configured." });
  }

  const body = req.body as { query?: unknown } | undefined;
  const raw = typeof body?.query === "string" ? body.query : "";
  const query = raw.trim().slice(0, 300);
  if (query.length < 3) {
    return res.status(400).json({
      success: false,
      message: "Type a longer lyric line — at least a few words gives us something to match on.",
    });
  }

  // Log length only — the raw query is user-spoken lyrics and may be sensitive.
  log.info({ queryLen: query.length }, "Lyric search received");

  let geniusHits: Array<{ title: string; artist: string }> = [];
  try {
    geniusHits = await searchGenius(query, token);
  } catch (err) {
    log.error({ err }, "Genius search failed");
    return res.status(502).json({ success: false, message: "Lyric search is unavailable right now. Try again in a moment." });
  }

  if (geniusHits.length === 0) {
    log.info("Genius returned no hits");
    return res.json({ success: true, results: [] });
  }

  // Enrich each candidate with LRCLIB availability so the UI can show a
  // "synced" / "plain" badge. We intentionally DO NOT resort by availability:
  // Genius's relevance ranking (which is full-text over lyric bodies) is the
  // strongest signal that this song actually contains the snippet the user
  // sang. LRCLIB availability is a UI hint, not a ranking criterion.
  const enriched: Candidate[] = await Promise.all(
    geniusHits.map(async (h): Promise<Candidate> => {
      const { hasSynced, hasPlain } = await checkLrclib(h.artist, h.title);
      return { ...h, hasSynced, hasPlain };
    }),
  );

  log.info(
    {
      total: enriched.length,
      synced: enriched.filter((c) => c.hasSynced).length,
      plain: enriched.filter((c) => !c.hasSynced && c.hasPlain).length,
    },
    "Lyric search results returned",
  );

  return res.json({ success: true, results: enriched });
});

export default router;
