import { Router, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { identifyFromLyrics, type FetchedLyrics, type SearchHit } from "../lib/lyric-rank";

const router = Router();

// Simple per-IP rate limiter: 60 requests / 5 min. Live Cover ID now searches
// progressively while listening (after ~5 words, then again as more arrive,
// at most 4 times per listen), so one identification can use several requests.
// Repeat lookups are served from the caches below.
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 60;
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
        stats?: { pageviews?: number };
      };
    }>;
  };
}

interface LrcLibRecord {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
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

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 4500): Promise<globalThis.Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---- Small TTL caches -------------------------------------------------------
// Live Cover ID searches progressively as more words arrive (5 words, then 8,
// then 11…), so the same candidates come up again seconds later. Caching keeps
// follow-up searches fast and stays polite to Genius / LRCLIB.
class TtlCache<V> {
  private map = new Map<string, { v: V; at: number }>();
  constructor(private max: number, private ttlMs: number) {}
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttlMs) { this.map.delete(k); return undefined; }
    this.map.delete(k);
    this.map.set(k, e); // refresh LRU position
    return e.v;
  }
  set(k: string, v: V): void {
    this.map.set(k, { v, at: Date.now() });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}
const searchCache = new TtlCache<SearchHit[]>(1000, 6 * 60 * 60 * 1000);
const lyricsCache = new TtlCache<FetchedLyrics>(3000, 24 * 60 * 60 * 1000);

async function searchGenius(query: string, token: string): Promise<SearchHit[]> {
  const ck = query.toLowerCase();
  const cached = searchCache.get(ck);
  if (cached) return cached;
  const url = `https://api.genius.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Genius search HTTP ${res.status}`);
  }
  const data = (await res.json()) as GeniusSearchResponse;
  const hits = data.response?.hits ?? [];
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (h.type && h.type !== "song") continue;
    const title = h.result?.title?.trim();
    const artist = h.result?.primary_artist?.name?.trim();
    if (!title || !artist) continue;
    const key = `${artist.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pageviews = h.result?.stats?.pageviews;
    out.push({ title, artist, ...(typeof pageviews === "number" ? { pageviews } : {}) });
    if (out.length >= 10) break;
  }
  searchCache.set(ck, out);
  return out;
}

// LRCLIB is a free service and rate-limits bursts (HTTP 429). Space our
// requests out server-wide instead of firing a candidate list all at once.
const LRCLIB_MIN_GAP_MS = 120;
let lrclibNextSlot = 0;
async function lrclibFetch(url: string): Promise<globalThis.Response> {
  const now = Date.now();
  const slot = Math.max(now, lrclibNextSlot);
  lrclibNextSlot = slot + LRCLIB_MIN_GAP_MS;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  let res = await fetchWithTimeout(url);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 600));
    res = await fetchWithTimeout(url);
  }
  return res;
}

/** Full lyrics for one candidate, used to verify the heard snippet is really
 *  in the song (and to find which line). Exact LRCLIB lookup first, then a
 *  fuzzy LRCLIB search on artist + title, then lyrics.ovh. */
async function fetchLyricsForCheck(artist: string, title: string): Promise<FetchedLyrics> {
  const ck = `${artist.toLowerCase()}|${title.toLowerCase()}`;
  const cached = lyricsCache.get(ck);
  if (cached) return cached;
  const cleaned = cleanTitle(title);
  const none: FetchedLyrics = { text: null, hasSynced: false, hasPlain: false };
  const toResult = (d: LrcLibRecord | null | undefined): FetchedLyrics | null => {
    if (!d) return null;
    const synced = typeof d.syncedLyrics === "string" && d.syncedLyrics.trim().length > 0;
    const plain = typeof d.plainLyrics === "string" && d.plainLyrics.trim().length > 0;
    if (!synced && !plain) return null;
    return { text: (plain ? d.plainLyrics : d.syncedLyrics) ?? null, hasSynced: synced, hasPlain: plain };
  };
  let result: FetchedLyrics | null = null;
  let transientFailure = false;
  const transient = (status: number) => status === 429 || status >= 500;
  try {
    const res = await lrclibFetch(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(cleaned)}`,
    );
    if (res.ok) result = toResult((await res.json()) as LrcLibRecord);
    else if (transient(res.status)) transientFailure = true;
  } catch {
    transientFailure = true;
  }
  if (!result && !transientFailure) {
    try {
      const res = await lrclibFetch(
        `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(cleaned)}`,
      );
      if (res.ok) {
        const arr = (await res.json()) as LrcLibRecord[];
        if (Array.isArray(arr)) {
          for (const r of arr) {
            result = toResult(r);
            if (result) break;
          }
        }
      } else if (transient(res.status)) transientFailure = true;
    } catch {
      transientFailure = true;
    }
  }
  if (!result) {
    // Second source, so a busy LRCLIB doesn't leave candidates unverified.
    try {
      const res = await fetchWithTimeout(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(cleaned)}`,
        {},
        4000,
      );
      if (res.ok) {
        const d = (await res.json()) as { lyrics?: string };
        if (typeof d.lyrics === "string" && d.lyrics.trim()) {
          result = { text: d.lyrics, hasSynced: false, hasPlain: true };
        }
      }
    } catch {
      /* ignore — lyrics.ovh is best-effort */
    }
  }
  const final = result ?? none;
  // Don't remember "no lyrics" if LRCLIB was just busy or down.
  if (result || !transientFailure) lyricsCache.set(ck, final);
  return final;
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

  let searchFailures = 0;
  let searchCalls = 0;
  try {
    const result = await identifyFromLyrics(query, {
      search: async (q) => {
        searchCalls += 1;
        try {
          return await searchGenius(q, token);
        } catch (err) {
          searchFailures += 1;
          throw err;
        }
      },
      lyrics: fetchLyricsForCheck,
    });

    if (searchCalls > 0 && searchFailures === searchCalls) {
      log.error("All Genius searches failed");
      return res.status(502).json({ success: false, message: "Lyric search is unavailable right now. Try again in a moment." });
    }

    log.info(
      {
        total: result.results.length,
        confidence: result.confidence.level,
        score: Number(result.confidence.score.toFixed(2)),
        margin: Number(result.confidence.margin.toFixed(2)),
        queries: result.queries.length,
      },
      "Lyric search results returned",
    );

    return res.json({
      success: true,
      results: result.results,
      confidence: result.confidence,
      heard: result.heard,
    });
  } catch (err) {
    log.error({ err }, "Lyric search failed");
    return res.status(502).json({ success: false, message: "Lyric search is unavailable right now. Try again in a moment." });
  }
});

export default router;
