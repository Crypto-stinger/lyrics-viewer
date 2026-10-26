export interface LrcLine {
  timeMs: number;
  text: string;
}

export async function fetchLrc(artist: string, title: string): Promise<LrcLine[] | null> {
  try {
    const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { syncedLyrics?: string | null };
    if (!data.syncedLyrics) return null;
    const parsed = parseLrc(data.syncedLyrics);
    return parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function parseLrc(text: string): LrcLine[] {
  const out: LrcLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const tagRe = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
    const tags: number[] = [];
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    while ((match = tagRe.exec(raw)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseFloat(match[2]);
      if (Number.isFinite(min) && Number.isFinite(sec)) {
        tags.push(min * 60_000 + sec * 1000);
        lastEnd = match.index + match[0].length;
      }
    }
    const txt = raw.slice(lastEnd).trim();
    if (txt && tags.length > 0) {
      for (const t of tags) out.push({ timeMs: t, text: txt });
    }
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}
