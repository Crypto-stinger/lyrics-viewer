import { useState } from "react";
import { useLocation } from "wouter";
import { Search, Loader2, Music, Heart, ExternalLink, Mic, Monitor, Moon, WifiOff, ListMusic } from "lucide-react";
import { Layout } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CoverIdModal } from "@/components/cover-id-modal";
import { useCurrentSong } from "@/hooks/use-current-song";
import { useFavorites } from "@/hooks/use-favorites";
import { fetchLyrics } from "@/lib/lyrics";

interface ItunesTrack {
  trackId: number;
  artistName: string;
  trackName: string;
  collectionName?: string;
  artworkUrl60?: string;
}

type SearchMode = "both" | "artist-only" | "song-only";

function getSearchMode(artist: string, title: string): SearchMode | null {
  const a = artist.trim();
  const t = title.trim();
  if (a && t) return "both";
  if (a) return "artist-only";
  if (t) return "song-only";
  return null;
}

async function searchItunes(artist: string, title: string, mode: SearchMode): Promise<ItunesTrack[]> {
  let url = "";
  if (mode === "both") {
    const term = encodeURIComponent(`${artist.trim()} ${title.trim()}`);
    url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=30`;
  } else if (mode === "artist-only") {
    const term = encodeURIComponent(artist.trim());
    url = `https://itunes.apple.com/search?term=${term}&entity=song&attribute=artistTerm&limit=50`;
  } else {
    const term = encodeURIComponent(title.trim());
    url = `https://itunes.apple.com/search?term=${term}&entity=song&attribute=songTerm&limit=50`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not reach iTunes search");
  const data = await res.json();
  return (data.results ?? []) as ItunesTrack[];
}

const FEATURES = [
  { icon: Monitor,   title: "Live Lyric Display", desc: "Large, stage-friendly lyrics for singers and performers." },
  { icon: ListMusic, title: "Setlists",            desc: "Prepare songs in performance order before the gig." },
  { icon: Moon,      title: "Dark Mode",           desc: "Easy on the eyes during rehearsals and live shows." },
  { icon: Mic,       title: "Live Cover ID",       desc: "Identify unknown songs from live bands and open the lyrics quickly." },
  { icon: Search,    title: "Lyric Search",        desc: "Find songs by title, artist, or lyric line." },
  { icon: WifiOff,   title: "Offline Ready",       desc: "Save important lyrics for use when internet access is unreliable." },
];

export default function SearchPage() {
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchingId, setFetchingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ItunesTrack[]>([]);
  const [searchMode, setSearchMode] = useState<SearchMode | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [showCoverId, setShowCoverId] = useState(false);

  const { setCurrentSong } = useCurrentSong();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [, setLocation] = useLocation();

  const canSearch = !!(artist.trim() || title.trim());

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const mode = getSearchMode(artist, title);
    if (!mode) return;

    setLoading(true);
    setError(null);
    setResults([]);
    setHasSearched(false);
    setSearchMode(mode);

    try {
      const tracks = await searchItunes(artist, title, mode);
      setResults(tracks);
      setHasSearched(true);
      if (tracks.length === 0) setError("No songs found. Try a different spelling or search term.");
    } catch {
      setError("Search failed. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTrack = async (track: ItunesTrack) => {
    setFetchingId(track.trackId);
    const lyrics = await fetchLyrics(track.artistName, track.trackName);
    setFetchingId(null);
    setCurrentSong({ artist: track.artistName, title: track.trackName, lyrics });
    setLocation("/view");
  };

  const handleOpenLyrics = async (artist: string, title: string) => {
    setShowCoverId(false);
    const lyrics = await fetchLyrics(artist, title);
    setCurrentSong({ artist, title, lyrics });
    setLocation("/view");
  };

  const modeLabel =
    searchMode === "artist-only" ? `Songs by "${artist.trim()}"` :
    searchMode === "song-only"   ? `Versions of "${title.trim()}"` :
    searchMode === "both"        ? `Results for "${artist.trim()} — ${title.trim()}"` : "";

  const showLanding = !hasSearched && !loading;

  return (
    <Layout>
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 flex flex-col">

        {/* Hero */}
        <div className="text-center pt-12 pb-8">
          <div className="inline-flex items-center gap-3 mb-5">
            <span className="h-px w-10 bg-primary/30" />
            <span className="text-xs font-semibold tracking-widest uppercase text-primary/70">For singers &amp; cover bands</span>
            <span className="h-px w-10 bg-primary/30" />
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl font-bold text-foreground leading-tight mb-4">
            <span className="text-aurora">Lyrics</span> on stage,<br className="hidden sm:block" /> without the panic.
          </h1>
          <p className="text-muted-foreground max-w-md mx-auto leading-relaxed text-base">
            Lyra helps singers, musicians, and cover bands organise, display, and quickly find lyrics during live performance.
          </p>
        </div>

        {/* Search card */}
        <form
          onSubmit={handleSearch}
          className="bg-card border border-card-border rounded-2xl shadow-sm overflow-hidden"
          data-testid="search-form"
        >
          <div className="p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-1.5">
                <label htmlFor="artist" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Artist</label>
                <Input
                  id="artist"
                  data-testid="input-artist"
                  placeholder="e.g. The Cranberries"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="h-11 bg-background"
                />
              </div>
              <div className="hidden sm:flex items-end pb-2 text-muted-foreground/40 font-serif text-lg select-none">—</div>
              <div className="flex-1 space-y-1.5">
                <label htmlFor="title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Song Title</label>
                <Input
                  id="title"
                  data-testid="input-title"
                  placeholder="e.g. Linger"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-11 bg-background"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground/80">
              Artist only finds all their tracks · Title only finds all versions · Both gives the closest match
            </p>
          </div>

          <div className="border-t border-card-border px-5 sm:px-6 py-4 bg-muted/30 flex flex-col sm:flex-row gap-2">
            <Button
              type="submit"
              data-testid="button-search"
              className="flex-1 h-11 text-sm font-semibold"
              disabled={loading || !canSearch}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Searching…</>
                : <><Search className="w-4 h-4 mr-2" /> Search Lyrics</>
              }
            </Button>
            <Button
              type="button"
              data-testid="button-cover-id"
              variant="outline"
              className="h-11 text-sm font-semibold"
              onClick={() => setShowCoverId(true)}
            >
              <Mic className="w-4 h-4 mr-2" /> Live Cover ID
            </Button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="mt-6 p-4 bg-destructive/10 border border-destructive/20 text-destructive text-center rounded-xl text-sm font-medium" data-testid="search-error">
            {error}
          </div>
        )}

        {/* Results */}
        {hasSearched && results.length > 0 && (
          <div className="mt-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-400">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-serif text-lg font-semibold text-foreground" data-testid="results-heading">
                {modeLabel}
              </h2>
              <span className="text-xs text-muted-foreground">{results.length} result{results.length !== 1 ? "s" : ""}</span>
            </div>
            <ul className="divide-y divide-border/60 border border-card-border rounded-2xl overflow-hidden" data-testid="results-list">
              {results.map((track) => {
                const fav = isFavorite(track.artistName, track.trackName);
                const fetching = fetchingId === track.trackId;
                return (
                  <li
                    key={track.trackId}
                    className="bg-card flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
                    data-testid={`track-item-${track.trackId}`}
                  >
                    {track.artworkUrl60 ? (
                      <img src={track.artworkUrl60} alt={track.trackName} className="w-10 h-10 rounded-lg shrink-0 object-cover" data-testid={`track-art-${track.trackId}`} />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Music className="w-4 h-4 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground leading-snug" data-testid={`track-title-${track.trackId}`}>
                        <span className="font-semibold">{track.trackName}</span>
                        <span className="text-muted-foreground/60 mx-1.5">—</span>
                        <span className="text-muted-foreground" data-testid={`track-artist-${track.trackId}`}>{track.artistName}</span>
                      </p>
                      {track.collectionName && (
                        <p className="text-xs text-muted-foreground/55 mt-0.5 truncate">{track.collectionName}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        data-testid={`button-favorite-${track.trackId}`}
                        className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                        onClick={() => toggleFavorite(track.artistName, track.trackName)}
                        title={fav ? "Remove from favorites" : "Add to favorites"}
                      >
                        <Heart className={`w-4 h-4 transition-all ${fav ? "fill-secondary text-secondary scale-110" : ""}`} />
                      </button>
                      <Button
                        size="sm"
                        data-testid={`button-read-${track.trackId}`}
                        className="gap-1.5 h-8 px-3 text-xs"
                        disabled={fetching}
                        onClick={() => handleSelectTrack(track)}
                      >
                        {fetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                        {fetching ? "Loading" : "Read"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Feature cards + cover bands — landing only */}
        {showLanding && (
          <>
            <div className="mt-12">
              <h2 className="text-center font-serif text-2xl font-bold text-foreground mb-2">
                Built for singers, musicians and cover bands
              </h2>
              <p className="text-center text-muted-foreground text-sm mb-8 max-w-md mx-auto">
                Everything you need to stay on top of your lyrics, on stage and off.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {FEATURES.map((f) => (
                  <div key={f.title} className="bg-card border border-card-border rounded-xl p-4 space-y-2 hover:border-primary/30 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <f.icon className="w-4 h-4 text-primary" />
                    </div>
                    <p className="font-semibold text-sm text-foreground">{f.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-10 mb-16 bg-primary/5 border border-primary/15 rounded-2xl p-6 sm:p-8">
              <h2 className="font-serif text-2xl font-bold text-foreground mb-3">Built for cover bands</h2>
              <p className="text-muted-foreground text-sm leading-relaxed mb-5 max-w-prose">
                When someone requests a song, or the band starts playing something unexpected,
                Lyra helps you identify the track, find the lyrics, and get back into the performance quickly.
              </p>
              <ul className="space-y-2 mb-6">
                {["Identify songs from live audio","Search by lyric snippets","Open matching lyrics instantly","Build and save setlists","Use large text on stage"].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-foreground">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button onClick={() => setShowCoverId(true)} data-testid="button-cover-id-cta">
                <Mic className="w-4 h-4 mr-2" /> Try Live Cover ID
              </Button>
            </div>
          </>
        )}
      </div>

      {showCoverId && (
        <CoverIdModal onClose={() => setShowCoverId(false)} onOpenLyrics={handleOpenLyrics} />
      )}
    </Layout>
  );
}
