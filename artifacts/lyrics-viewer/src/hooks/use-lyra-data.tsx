import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGetMyDataQueryKey,
  getMyData,
  putMyData,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

// ---- Shared TS shapes (mirrored from the legacy hooks) -----------------------
// Keep these in sync with the per-hook re-exports so existing components keep
// importing { Setlist } from "@/hooks/use-setlists" etc. without changes.

export interface SetlistSong {
  artist: string;
  title: string;
}

export interface Setlist {
  id: string;
  name: string;
  songs: SetlistSong[];
  createdAt: number;
  updatedAt: number;
}

export interface SetlistSongOverride {
  customLyrics?: string;
  capo?: string;
  tempo?: string;
  key?: string;
  notes?: string;
  updatedAt: number;
}

export type OverridesMap = Record<string, Record<string, SetlistSongOverride>>;

export interface SongNotes {
  capo?: string;
  tempo?: string;
  notes?: string;
  updatedAt: number;
}

export type SongNotesMap = Record<string, SongNotes>;

export interface FavoriteSong {
  artist: string;
  title: string;
}

export type SongKeyMap = Record<string, string>;

export interface LyraData {
  setlists: Setlist[];
  setlistOverrides: OverridesMap;
  songNotes: SongNotesMap;
  favorites: FavoriteSong[];
  songKeys: SongKeyMap;
}

export const EMPTY_DATA: LyraData = {
  setlists: [],
  setlistOverrides: {},
  songNotes: {},
  favorites: [],
  songKeys: {},
};

// ---- Storage layer -----------------------------------------------------------
// Keys preserved from the original hooks so signed-out users keep their data
// and signed-in users have a path to import on first login.
const KEYS = {
  setlists: "lyra_setlists",
  setlistOverrides: "lyra:setlist-overrides",
  songNotes: "lyra:song-notes",
  favorites: "lyrics_favorites",
  songKeys: "lyrics_song_keys",
} as const;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

function readLocalSnapshot(): LyraData {
  return {
    setlists: readJson<Setlist[]>(KEYS.setlists, []),
    setlistOverrides: readJson<OverridesMap>(KEYS.setlistOverrides, {}),
    songNotes: readJson<SongNotesMap>(KEYS.songNotes, {}),
    favorites: readJson<FavoriteSong[]>(KEYS.favorites, []),
    songKeys: readJson<SongKeyMap>(KEYS.songKeys, {}),
  };
}

function writeLocalSnapshot(d: LyraData): void {
  writeJson(KEYS.setlists, d.setlists);
  writeJson(KEYS.setlistOverrides, d.setlistOverrides);
  writeJson(KEYS.songNotes, d.songNotes);
  writeJson(KEYS.favorites, d.favorites);
  writeJson(KEYS.songKeys, d.songKeys);
}

function isEmptySnapshot(d: LyraData): boolean {
  return (
    d.setlists.length === 0 &&
    Object.keys(d.setlistOverrides).length === 0 &&
    Object.keys(d.songNotes).length === 0 &&
    d.favorites.length === 0 &&
    Object.keys(d.songKeys).length === 0
  );
}

// ---- Context -----------------------------------------------------------------
interface LyraDataContextValue {
  data: LyraData;
  /** Apply a pure mutation; persisted to the active backend (server or local). */
  update: (mutator: (prev: LyraData) => LyraData) => void;
  /** True when a server sync is pending. UI can ignore for non-blocking flows. */
  isSyncing: boolean;
  /** True once the snapshot has been loaded from its backend (server fetch
   *  resolved or localStorage hydrated). Prevents flash-of-empty for hooks
   *  that render lists. */
  isReady: boolean;
}

const LyraDataContext = createContext<LyraDataContextValue | undefined>(undefined);

export function LyraDataProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Local backend (used when signed out or as initial state before query loads)
  const [localData, setLocalData] = useState<LyraData>(readLocalSnapshot);
  const isFirstLocalWriteRef = useRef(true);

  // Persist localData to localStorage. Used both signed-out (canonical) and
  // signed-in (redundant cache; harmless).
  useEffect(() => {
    if (isFirstLocalWriteRef.current) {
      isFirstLocalWriteRef.current = false;
      return;
    }
    writeLocalSnapshot(localData);
  }, [localData]);

  // Cross-tab sync (signed-out only — signed-in tabs sync via react-query)
  useEffect(() => {
    if (isSignedIn) return;
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !Object.values(KEYS).includes(e.key as typeof KEYS[keyof typeof KEYS])) return;
      setLocalData(readLocalSnapshot());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [isSignedIn]);

  // Server backend (only enabled when signed in)
  const queryKey = getGetMyDataQueryKey();
  const serverQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => getMyData({ signal }),
    enabled: isLoaded && !!isSignedIn,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const putMutation = useMutation({
    mutationFn: (snap: LyraData) =>
      putMyData(snap as unknown as Parameters<typeof putMyData>[0]),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.error("Failed to sync your changes", err);
      toast({
        title: "Couldn't sync changes",
        description: "Your edits are saved locally and will retry.",
        variant: "destructive",
      });
    },
  });

  // First-run import: when the user signs in and the server snapshot is empty
  // but their browser has localStorage data, push it up automatically. This
  // gives existing users a seamless transition into multi-device sync.
  const importedForUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isSignedIn || !userId) return;
    if (importedForUserRef.current === userId) return;
    if (!serverQuery.isSuccess) return;
    const server = serverQuery.data as unknown as LyraData | undefined;
    if (!server) return;
    if (!isEmptySnapshot(server)) {
      // Server already has data — no import. Mark done so we don't keep checking.
      importedForUserRef.current = userId;
      return;
    }
    const local = readLocalSnapshot();
    if (isEmptySnapshot(local)) {
      importedForUserRef.current = userId;
      return;
    }
    importedForUserRef.current = userId;
    putMutation.mutate(local, {
      onSuccess: () => {
        toast({
          title: "Welcome to Lyra",
          description: "Your existing setlists, notes and favourites are now synced to your account.",
        });
      },
    });
    // We intentionally only depend on these — we want this to fire once per
    // signed-in user once the server query has resolved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userId, serverQuery.isSuccess, serverQuery.data]);

  // The "active" snapshot is the server one when signed in (after load),
  // otherwise local. We cast loosely because the spec types the slices as
  // unknown — they round-trip as JSON and the in-app TS types are the source
  // of truth.
  const activeData: LyraData = useMemo(() => {
    if (isSignedIn && serverQuery.data) {
      // The OpenAPI schema for slices is loose (`unknown`); the in-app TS
      // types are the source of truth. Cast through unknown to bridge.
      const s = serverQuery.data as unknown as Partial<LyraData>;
      return {
        setlists: (s.setlists as Setlist[]) ?? [],
        setlistOverrides: (s.setlistOverrides as OverridesMap) ?? {},
        songNotes: (s.songNotes as SongNotesMap) ?? {},
        favorites: (s.favorites as FavoriteSong[]) ?? [],
        songKeys: (s.songKeys as SongKeyMap) ?? {},
      };
    }
    return localData;
  }, [isSignedIn, serverQuery.data, localData]);

  // Debounced server PUT so a flurry of edits (e.g. dragging a song multiple
  // positions) collapses into one network round-trip.
  const pendingSnapshotRef = useRef<LyraData | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const flushPending = useCallback(() => {
    debounceTimerRef.current = null;
    const snap = pendingSnapshotRef.current;
    pendingSnapshotRef.current = null;
    if (snap) putMutation.mutate(snap);
  }, [putMutation]);

  const update = useCallback(
    (mutator: (prev: LyraData) => LyraData) => {
      if (isSignedIn) {
        // Optimistic: write to react-query cache immediately so consumers see
        // the change synchronously, then debounce-PUT to the server.
        const prev = (queryClient.getQueryData(queryKey) as unknown as LyraData | undefined) ?? activeData;
        const next = mutator(prev);
        queryClient.setQueryData(queryKey, next);
        // Also mirror to localStorage so signing out / offline keeps the data.
        setLocalData(next);
        pendingSnapshotRef.current = next;
        if (debounceTimerRef.current !== null) {
          window.clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = window.setTimeout(flushPending, 600);
      } else {
        setLocalData(prev => mutator(prev));
      }
    },
    [isSignedIn, queryClient, queryKey, activeData, flushPending],
  );

  // Flush any pending edits when the page is hidden / unmounted so we don't
  // lose the last keystroke before the user closes the tab.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && pendingSnapshotRef.current) {
        if (debounceTimerRef.current !== null) {
          window.clearTimeout(debounceTimerRef.current);
        }
        flushPending();
      }
    };
    window.addEventListener("visibilitychange", onVisibility);
    return () => window.removeEventListener("visibilitychange", onVisibility);
  }, [flushPending]);

  const value = useMemo<LyraDataContextValue>(
    () => ({
      data: activeData,
      update,
      isSyncing: putMutation.isPending,
      isReady: isLoaded && (!isSignedIn || serverQuery.isFetched),
    }),
    [activeData, update, putMutation.isPending, isLoaded, isSignedIn, serverQuery.isFetched],
  );

  return <LyraDataContext.Provider value={value}>{children}</LyraDataContext.Provider>;
}

export function useLyraData(): LyraDataContextValue {
  const ctx = useContext(LyraDataContext);
  if (!ctx) throw new Error("useLyraData must be used within a LyraDataProvider");
  return ctx;
}

// Shared utility — the canonical "song key" string for map lookups.
export function songKey(artist: string, title: string): string {
  return `${artist.toLowerCase().trim()}::${title.toLowerCase().trim()}`;
}
