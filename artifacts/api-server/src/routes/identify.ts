import { Router, type Request, type Response, type NextFunction } from "express";
import multer, { MulterError } from "multer";
import crypto from "node:crypto";
import { logger } from "../lib/logger";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function getMissingAcrSecrets(): string[] {
  return ["ACRCLOUD_HOST", "ACRCLOUD_ACCESS_KEY", "ACRCLOUD_ACCESS_SECRET"].filter(
    (k) => !process.env[k],
  );
}

interface MatchResult {
  title: string;
  artist: string;
  album: string;
  confidence: number;
  source: string;
  playOffsetMs?: number;
  durationMs?: number;
}

interface AcrCloudResponse {
  status: { code: number; msg: string; version?: string };
  metadata?: {
    music?: Array<{
      title: string;
      score: number;
      artists?: Array<{ name: string }>;
      album?: { name: string };
      play_offset_ms?: number;
      duration_ms?: number;
    }>;
    cover_songs?: Array<{
      title: string;
      score: number;
      artists?: Array<{ name: string }>;
      album?: { name: string };
    }>;
    humming?: Array<{
      title: string;
      score: number;
      artists?: Array<{ name: string }>;
    }>;
  };
}

async function identifyWithAcrCloud(buf: Buffer): Promise<{ match: MatchResult | null; rawStatus: { code: number; msg: string }; bucketsHit: string[] }> {
  const host = process.env.ACRCLOUD_HOST!;
  const accessKey = process.env.ACRCLOUD_ACCESS_KEY!;
  const accessSecret = process.env.ACRCLOUD_ACCESS_SECRET!;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `POST\n/v1/identify\n${accessKey}\naudio\n1\n${timestamp}`;
  const signature = crypto
    .createHmac("sha1", accessSecret)
    .update(stringToSign)
    .digest("base64");

  const form = new FormData();
  form.append("access_key", accessKey);
  form.append("data_type", "audio");
  form.append("signature_version", "1");
  form.append("signature", signature);
  form.append("timestamp", timestamp);
  form.append("sample_bytes", buf.length.toString());
  form.append("sample", new Blob([new Uint8Array(buf)]), "sample.webm");

  const res = await fetch(`https://${host}/v1/identify`, { method: "POST", body: form });
  if (!res.ok) {
    return {
      match: null,
      rawStatus: { code: -1, msg: `HTTP ${res.status} ${res.statusText}` },
      bucketsHit: [],
    };
  }

  const data = (await res.json()) as AcrCloudResponse;
  const bucketsHit: string[] = [];
  if (data.metadata?.music?.length) bucketsHit.push(`music:${data.metadata.music.length}`);
  if (data.metadata?.cover_songs?.length) bucketsHit.push(`cover_songs:${data.metadata.cover_songs.length}`);
  if (data.metadata?.humming?.length) bucketsHit.push(`humming:${data.metadata.humming.length}`);

  if (data.status.code !== 0) {
    return { match: null, rawStatus: data.status, bucketsHit };
  }

  // Try the strongest bucket first: music (exact recording), then cover_songs,
  // then humming. We narrow by checking each in turn so TS keeps the discriminated
  // shape for fields like `album` / `play_offset_ms` which only exist on `music`.
  // ACRCloud's music bucket returns scores 0-100, but humming and cover_songs
  // buckets return scores on a 0-1 scale. Normalize everything to 0-100.
  const normalize = (s: number | undefined): number => {
    if (s === undefined || s === null) return 100;
    return s <= 1 ? Math.round(s * 100) : Math.round(s);
  };

  const music = data.metadata?.music?.[0];
  if (music) {
    return {
      match: {
        title: music.title,
        artist: music.artists?.[0]?.name ?? "Unknown Artist",
        album: music.album?.name ?? "",
        confidence: normalize(music.score),
        source: "acrcloud",
        playOffsetMs: music.play_offset_ms,
        durationMs: music.duration_ms,
      },
      rawStatus: data.status,
      bucketsHit,
    };
  }
  const cover = data.metadata?.cover_songs?.[0];
  if (cover) {
    return {
      match: {
        title: cover.title,
        artist: cover.artists?.[0]?.name ?? "Unknown Artist",
        album: cover.album?.name ?? "",
        confidence: normalize(cover.score),
        source: "acrcloud-cover",
      },
      rawStatus: data.status,
      bucketsHit,
    };
  }
  // Intentionally ignore ACRCloud's humming bucket. In practice (especially on
  // the Asia-Southeast region) it returns near-random cross-language matches
  // with confidence values that are statistically meaningless — surfacing them
  // is worse than returning no match. We rely on the `music` (exact recording)
  // and `cover_songs` (real cover database) buckets only.
  return { match: null, rawStatus: data.status, bucketsHit };
}

function multipartUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("audio")(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "Audio file too large. Recordings should be under 10 MB."
          : "Could not read the uploaded audio. Please try again.";
      res.status(status).json({ success: false, message });
      return;
    }
    if (err) {
      logger.error({ err }, "Unknown upload error");
      res.status(400).json({ success: false, message: "Upload failed. Please try again." });
      return;
    }
    next();
  });
}

// Lightweight position-only sync endpoint — ACRCloud only (returns playback offset).
// The previous /identify-song fingerprint endpoint was removed because in practice
// ACRCloud almost never matched live cover-band performances, and running it in
// parallel with Web Speech caused a mic-capture conflict on Chrome Android that
// silently disabled lyric transcription. Song identification is now handled
// client-side via Web Speech → /api/lyric-search.
router.post("/sync-position", multipartUpload, async (req, res) => {
  const log = req.log;
  if (getMissingAcrSecrets().length > 0) {
    return res.status(503).json({ success: false, message: "ACRCloud is not configured." });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No audio file received." });
  }
  try {
    const { match } = await identifyWithAcrCloud(req.file.buffer);
    if (!match || match.playOffsetMs === undefined) {
      return res.json({ success: false, message: "Could not locate position in song." });
    }
    return res.json({
      success: true,
      title: match.title,
      artist: match.artist,
      playOffsetMs: match.playOffsetMs,
      durationMs: match.durationMs,
      capturedAt: Date.now(),
    });
  } catch (err) {
    log.error({ err }, "sync-position failed");
    return res.status(500).json({ success: false, message: "Position lookup failed." });
  }
});

export default router;
