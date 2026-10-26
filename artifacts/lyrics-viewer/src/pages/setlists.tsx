import { useState } from "react";
import { useLocation } from "wouter";
import { ListMusic, Plus, Trash2, ChevronUp, ChevronDown, ArrowRight, Pencil, Loader2, Music, NotebookPen, Wand2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSetlists, Setlist } from "@/hooks/use-setlists";
import { useCurrentSong } from "@/hooks/use-current-song";
import { useSongNotes } from "@/hooks/use-song-notes";
import { useSetlistOverrides } from "@/hooks/use-setlist-overrides";
import { fetchLyrics } from "@/lib/lyrics";

export default function SetlistsPage() {
  const { setlists, createSetlist, renameSetlist, deleteSetlist, removeSong, moveSong } = useSetlists();
  const { setCurrentSong } = useCurrentSong();
  const { hasNotes } = useSongNotes();
  const { hasOverride, hasCustomLyrics, clearOverride, clearSetlist } = useSetlistOverrides();
  const [, setLocation] = useLocation();
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    const sl = createSetlist(name);
    setNewName("");
    setOpenId(sl.id);
  };

  const handleStartRename = (sl: Setlist) => {
    setRenamingId(sl.id);
    setRenameValue(sl.name);
  };

  const handleCommitRename = () => {
    if (renamingId) renameSetlist(renamingId, renameValue);
    setRenamingId(null);
    setRenameValue("");
  };

  const openSongInSetlist = async (setlistId: string, index: number, song: { artist: string; title: string }) => {
    const k = `${setlistId}-${index}`;
    setLoadingKey(k);
    try {
      const lyrics = await fetchLyrics(song.artist, song.title);
      setCurrentSong({ artist: song.artist, title: song.title, lyrics });
    } catch {
      setCurrentSong({ artist: song.artist, title: song.title, lyrics: null });
    } finally {
      setLoadingKey(null);
      setLocation(`/view?setlist=${encodeURIComponent(setlistId)}&i=${index}`);
    }
  };

  return (
    <Layout>
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl font-bold text-foreground">Setlists</h1>
            <p className="text-muted-foreground mt-2">Plan your gigs. Tap Next on stage to advance through the songs in order.</p>
          </div>
          <ListMusic className="w-8 h-8 text-primary opacity-50" />
        </div>

        {/* Create */}
        <div className="bg-card border border-card-border rounded-xl p-4 sm:p-5 mb-8 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              data-testid="input-setlist-name"
              placeholder="New setlist name (e.g. Saturday — Red Lion)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              className="flex-1"
            />
            <Button
              data-testid="button-create-setlist"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              <Plus className="w-4 h-4 mr-1.5" /> Create
            </Button>
          </div>
        </div>

        {setlists.length === 0 ? (
          <div className="text-center py-20 bg-card border border-card-border rounded-2xl shadow-sm">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4 text-muted-foreground">
              <ListMusic className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold mb-2">No setlists yet</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Create a setlist above, then add songs from any lyrics page.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {setlists.map((sl) => {
              const isOpen = openId === sl.id;
              const isRenaming = renamingId === sl.id;
              return (
                <div key={sl.id} data-testid={`setlist-card-${sl.id}`} className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
                  <div className="flex items-center gap-3 p-4 sm:p-5">
                    <div className="flex-1 min-w-0">
                      {isRenaming ? (
                        <Input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={handleCommitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleCommitRename();
                            if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
                          }}
                          className="text-lg font-semibold"
                        />
                      ) : (
                        <button
                          onClick={() => setOpenId(isOpen ? null : sl.id)}
                          className="text-left min-w-0 w-full"
                          aria-expanded={isOpen}
                        >
                          <h3 className="font-serif text-xl font-bold text-foreground truncate">{sl.name}</h3>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {sl.songs.length} {sl.songs.length === 1 ? "song" : "songs"}
                          </p>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!isRenaming && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleStartRename(sl)}
                          title="Rename"
                          data-testid={`button-rename-${sl.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (confirm(`Delete setlist "${sl.name}"? This cannot be undone.`)) {
                            // Drop all per-setlist stage versions first so we don't
                            // leave orphaned overrides in localStorage.
                            clearSetlist(sl.id);
                            deleteSetlist(sl.id);
                          }
                        }}
                        title="Delete setlist"
                        data-testid={`button-delete-setlist-${sl.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-border/40 bg-muted/20">
                      {sl.songs.length === 0 ? (
                        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                          No songs in this setlist yet. Open a song's lyrics page and tap "Add to setlist" in the menu.
                        </div>
                      ) : (
                        <ul className="divide-y divide-border/40">
                          {sl.songs.map((song, i) => {
                            const k = `${sl.id}-${i}`;
                            const isLoading = loadingKey === k;
                            return (
                              <li key={i} className="flex items-center gap-2 px-3 sm:px-5 py-3">
                                <span className="w-6 text-center text-sm font-semibold text-muted-foreground tabular-nums shrink-0">{i + 1}</span>
                                <button
                                  onClick={() => openSongInSetlist(sl.id, i, song)}
                                  className="flex-1 text-left min-w-0 group"
                                >
                                  <div className="text-foreground font-medium truncate group-hover:text-primary transition-colors flex items-center gap-1.5">
                                    <span className="truncate">{song.title}</span>
                                    {hasOverride(sl.id, song.artist, song.title) && (
                                      <Wand2
                                        className="w-3.5 h-3.5 text-primary shrink-0"
                                        aria-label={hasCustomLyrics(sl.id, song.artist, song.title) ? "Has stage version with edited lyrics" : "Has stage version"}
                                        data-testid={`setlist-song-has-stage-${sl.id}-${i}`}
                                      />
                                    )}
                                    {hasNotes(song.artist, song.title) && !hasOverride(sl.id, song.artist, song.title) && (
                                      <NotebookPen
                                        className="w-3.5 h-3.5 text-primary/70 shrink-0"
                                        aria-label="Has personal notes"
                                        data-testid={`setlist-song-has-notes-${sl.id}-${i}`}
                                      />
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate italic">{song.artist}</div>
                                </button>

                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button
                                    onClick={() => moveSong(sl.id, i, i - 1)}
                                    disabled={i === 0}
                                    className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-accent disabled:opacity-30"
                                    title="Move up"
                                  >
                                    <ChevronUp className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => moveSong(sl.id, i, i + 1)}
                                    disabled={i === sl.songs.length - 1}
                                    className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-accent disabled:opacity-30"
                                    title="Move down"
                                  >
                                    <ChevronDown className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      // Also drop the per-setlist stage version (if any) so
                                      // it can't silently come back if the song is re-added.
                                      clearOverride(sl.id, song.artist, song.title);
                                      removeSong(sl.id, i);
                                    }}
                                    className="text-muted-foreground hover:text-destructive p-1.5 rounded-md hover:bg-destructive/10"
                                    title="Remove from setlist"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => openSongInSetlist(sl.id, i, song)}
                                    disabled={isLoading}
                                    className="text-primary hover:bg-primary/10 p-1.5 rounded-md disabled:opacity-50"
                                    title="Open"
                                  >
                                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {sl.songs.length > 0 && (
                        <div className="px-5 py-3 border-t border-border/40 flex justify-end">
                          <Button
                            data-testid={`button-start-setlist-${sl.id}`}
                            onClick={() => openSongInSetlist(sl.id, 0, sl.songs[0])}
                            disabled={loadingKey?.startsWith(`${sl.id}-`)}
                            variant="default"
                          >
                            <Music className="w-4 h-4 mr-1.5" /> Start setlist
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
