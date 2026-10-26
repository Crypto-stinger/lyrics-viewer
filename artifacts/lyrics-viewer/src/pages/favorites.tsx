import { useState } from "react";
import { useLocation } from "wouter";
import { Music, Heart, Trash2, Loader2, ArrowRight, NotebookPen } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useFavorites } from "@/hooks/use-favorites";
import { useCurrentSong } from "@/hooks/use-current-song";
import { useSongNotes } from "@/hooks/use-song-notes";
import { fetchLyrics } from "@/lib/lyrics";

export default function FavoritesPage() {
  const { favorites, toggleFavorite } = useFavorites();
  const { setCurrentSong } = useCurrentSong();
  const { hasNotes } = useSongNotes();
  const [, setLocation] = useLocation();
  const [loadingSong, setLoadingSong] = useState<string | null>(null);

  const handleOpenSong = async (artist: string, title: string) => {
    const key = `${artist}-${title}`;
    setLoadingSong(key);
    try {
      const lyrics = await fetchLyrics(artist, title);
      setCurrentSong({ artist, title, lyrics });
      setLocation("/view");
    } catch {
      setCurrentSong({ artist, title, lyrics: null });
      setLocation("/view");
    } finally {
      setLoadingSong(null);
    }
  };

  return (
    <Layout>
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl font-bold text-foreground">Your Songs</h1>
            <p className="text-muted-foreground mt-2">Songs you've saved for later.</p>
          </div>
          <Heart className="w-8 h-8 text-secondary opacity-60" />
        </div>

        {favorites.length === 0 ? (
          <div className="text-center py-24 bg-card border border-card-border rounded-2xl shadow-sm">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4 text-muted-foreground">
              <Music className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold mb-2">No favorites yet</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              You haven't saved any songs yet. Search for lyrics and tap the heart icon to save them here.
            </p>
            <Button onClick={() => setLocation("/")} variant="default">
              Find a song
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {favorites.map((song, idx) => {
              const key = `${song.artist}-${song.title}`;
              const isLoading = loadingSong === key;
              
              return (
                <div 
                  key={idx} 
                  className="bg-card hover:bg-accent/50 border border-card-border rounded-xl p-4 sm:p-6 transition-colors flex flex-col sm:flex-row items-center gap-4 shadow-sm"
                >
                  <div className="flex-1 text-center sm:text-left w-full cursor-pointer group" onClick={() => handleOpenSong(song.artist, song.title)}>
                    <h3 className="font-serif text-xl font-bold text-foreground group-hover:text-primary transition-colors flex items-center gap-2 justify-center sm:justify-start">
                      <span>{song.title}</span>
                      {hasNotes(song.artist, song.title) && (
                        <NotebookPen
                          className="w-4 h-4 text-primary/70 shrink-0"
                          aria-label="Has personal notes"
                          data-testid={`favorite-has-notes-${idx}`}
                        />
                      )}
                    </h3>
                    <p className="text-muted-foreground">{song.artist}</p>
                  </div>
                  
                  <div className="flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-end">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(song.artist, song.title);
                      }}
                      title="Remove from favorites"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="secondary"
                      onClick={() => handleOpenSong(song.artist, song.title)}
                      disabled={isLoading}
                      className="min-w-[120px]"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>Open <ArrowRight className="w-4 h-4 ml-2" /></>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
