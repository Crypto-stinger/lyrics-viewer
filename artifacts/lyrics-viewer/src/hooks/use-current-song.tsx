import { createContext, useContext, useState, ReactNode } from "react";

interface SongData {
  artist: string;
  title: string;
  lyrics: string | null;
}

interface CurrentSongContextType {
  currentSong: SongData | null;
  setCurrentSong: (song: SongData | null) => void;
}

const CurrentSongContext = createContext<CurrentSongContextType | undefined>(undefined);

export function CurrentSongProvider({ children }: { children: ReactNode }) {
  const [currentSong, setCurrentSong] = useState<SongData | null>(null);

  return (
    <CurrentSongContext.Provider value={{ currentSong, setCurrentSong }}>
      {children}
    </CurrentSongContext.Provider>
  );
}

export function useCurrentSong() {
  const context = useContext(CurrentSongContext);
  if (context === undefined) {
    throw new Error("useCurrentSong must be used within a CurrentSongProvider");
  }
  return context;
}
