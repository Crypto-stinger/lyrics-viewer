async function firstSuccess(fetchers: (() => Promise<string | null>)[]): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = 0;
    const total = fetchers.length;

    if (total === 0) {
      resolve(null);
      return;
    }

    fetchers.forEach((fn) => {
      fn()
        .then((result) => {
          if (result && result.trim().length > 0) {
            resolve(result);
          }
        })
        .catch(() => {})
        .finally(() => {
          settled++;
          if (settled === total) {
            resolve(null);
          }
        });
    });
  });
}

async function fromLyricsOvh(artist: string, title: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.lyrics ?? null;
  } catch {
    return null;
  }
}

async function fromLrclib(artist: string, title: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    const res = await fetch(`https://lrclib.net/api/get?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.plainLyrics ?? data.syncedLyrics ?? null;
  } catch {
    return null;
  }
}

async function fromLrclibSearch(artist: string, title: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const res = await fetch(`https://lrclib.net/api/search?${params}`);
    if (!res.ok) return null;
    const results = await res.json();
    if (!Array.isArray(results) || results.length === 0) return null;
    const match = results[0];
    return match.plainLyrics ?? match.syncedLyrics ?? null;
  } catch {
    return null;
  }
}

export async function fetchLyrics(artist: string, title: string): Promise<string | null> {
  return firstSuccess([
    () => fromLyricsOvh(artist, title),
    () => fromLrclib(artist, title),
    () => fromLrclibSearch(artist, title),
  ]);
}
