import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFavorites } from "./use-favorites";
import { useSetlists } from "./use-setlists";
import { fetchLyrics } from "@/lib/lyrics";
import { fetchLrc } from "@/lib/lrc";

export interface PrecacheStatus {
  /** Total unique songs (favourites ∪ all setlist songs). */
  total: number;
  /** Songs whose lyrics or LRC have been confirmed cached this session. */
  warmed: number;
  /** True while a warming pump is actively fetching. */
  warming: boolean;
}

interface SongKey {
  artist: string;
  title: string;
}

const CONCURRENCY = 2; // be polite to lyrics.ovh / lrclib (free public APIs)
const STAGGER_MS = 150;
const SW_WAIT_TIMEOUT_MS = 10_000;

function key(s: SongKey): string {
  return `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;
}

/**
 * Resolves once the active service worker can intercept fetches from this page.
 *
 * - If no SW will ever register (e.g. unsupported browser), returns immediately
 *   so warming still happens (fetches go straight to the network and warm the
 *   browser HTTP cache, which is better than nothing).
 * - If a registration exists but no controller yet (first install), waits for
 *   `controllerchange` — `clientsClaim: true` in our Workbox config makes this
 *   fire as soon as the new SW activates.
 * - Times out after 10s as a safety net so warming isn't blocked indefinitely.
 */
async function waitForSwReady(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (navigator.serviceWorker.controller) return;
  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg = await navigator.serviceWorker.getRegistration();
  } catch {
    return;
  }
  if (!reg) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      navigator.serviceWorker.removeEventListener("controllerchange", finish);
      resolve();
    };
    navigator.serviceWorker.addEventListener("controllerchange", finish);
    if (navigator.serviceWorker.controller) finish();
    setTimeout(finish, SW_WAIT_TIMEOUT_MS);
  });
}

const PrecacheContext = createContext<PrecacheStatus>({
  total: 0,
  warmed: 0,
  warming: false,
});

/**
 * Background warmer for offline-ready gig songs.
 *
 * Invariants:
 * - A song is marked "warmed" only after at least one of fetchLyrics or
 *   fetchLrc returned a usable (non-null) payload. Failures (network down,
 *   API hiccup) leave it unwarmed so the next render / online event retries.
 * - We never start fetching until the service worker can intercept — without
 *   that gate, the first-session fetches would bypass the SW cache entirely
 *   and produce a misleading "all warmed" status.
 * - Concurrency capped + small stagger to be polite to the free public APIs.
 * - In-session in-flight set prevents duplicate requests when targets churn.
 */
export function PrecacheProvider({ children }: { children: ReactNode }) {
  const { favorites } = useFavorites();
  const { setlists } = useSetlists();

  const warmedRef = useRef<Set<string>>(new Set());
  const inflightRef = useRef<Set<string>>(new Set());
  const [warmedCount, setWarmedCount] = useState(0);
  const [warming, setWarming] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const targets = useMemo<SongKey[]>(() => {
    const all: SongKey[] = [
      ...favorites.map((f) => ({ artist: f.artist, title: f.title })),
      ...setlists.flatMap((sl) =>
        sl.songs.map((s) => ({ artist: s.artist, title: s.title })),
      ),
    ];
    const seen = new Set<string>();
    const out: SongKey[] = [];
    for (const s of all) {
      const k = key(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }, [favorites, setlists]);

  // Drop warmed entries that are no longer targets so the badge count stays
  // honest when the user removes favourites / clears setlists.
  useEffect(() => {
    const tk = new Set(targets.map(key));
    let changed = false;
    for (const k of warmedRef.current) {
      if (!tk.has(k)) {
        warmedRef.current.delete(k);
        changed = true;
      }
    }
    if (changed) setWarmedCount(warmedRef.current.size);
  }, [targets]);

  // Re-trigger warming when the device comes back online.
  useEffect(() => {
    const onOnline = () => setRetryTick((t) => t + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    // Compute todo using the current refs (NOT React state) so this effect's
    // dep array stays narrow — otherwise every successful warm would re-trigger
    // the effect and we'd spin starting fresh pumps unnecessarily.
    const todo = targets.filter((s) => {
      const k = key(s);
      return !warmedRef.current.has(k) && !inflightRef.current.has(k);
    });
    if (todo.length === 0) return;

    let cancelled = false;
    let cursor = 0;
    const inflight = new Set<Promise<unknown>>();

    async function pump(): Promise<void> {
      await waitForSwReady();
      if (cancelled) return;
      setWarming(true);
      try {
        while (!cancelled && cursor < todo.length) {
          if (inflight.size >= CONCURRENCY) {
            await Promise.race(inflight);
            continue;
          }
          const song = todo[cursor++];
          const k = key(song);
          inflightRef.current.add(k);
          const p = Promise.allSettled([
            fetchLyrics(song.artist, song.title),
            fetchLrc(song.artist, song.title),
          ]).then((results) => {
            inflight.delete(p);
            inflightRef.current.delete(k);
            if (cancelled) return;
            // Mark warmed only on real success — nulls (network down or song
            // unknown to upstream) leave it eligible for retry next pass.
            const ok = results.some(
              (r) => r.status === "fulfilled" && r.value != null,
            );
            if (ok && !warmedRef.current.has(k)) {
              warmedRef.current.add(k);
              setWarmedCount(warmedRef.current.size);
            }
          });
          inflight.add(p);
          await new Promise((r) => setTimeout(r, STAGGER_MS));
        }
        await Promise.allSettled([...inflight]);
      } finally {
        if (!cancelled) setWarming(false);
      }
    }

    void pump();
    return () => {
      cancelled = true;
    };
  }, [targets, retryTick]);

  const status = useMemo<PrecacheStatus>(
    () => ({ total: targets.length, warmed: warmedCount, warming }),
    [targets.length, warmedCount, warming],
  );

  return createElement(PrecacheContext.Provider, { value: status }, children);
}

export function usePrecacheStatus(): PrecacheStatus {
  return useContext(PrecacheContext);
}
