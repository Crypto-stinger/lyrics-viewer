import { useState, useEffect } from "react";

const MIN_ZOOM = 12;
const MAX_ZOOM = 40;
const DEFAULT_ZOOM = 18;

export function useZoom() {
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);

  useEffect(() => {
    const stored = localStorage.getItem("lyrics_zoom");
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= MIN_ZOOM && parsed <= MAX_ZOOM) {
        setZoom(parsed);
      }
    }
  }, []);

  const handleSetZoom = (newZoom: number) => {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    setZoom(clamped);
    localStorage.setItem("lyrics_zoom", clamped.toString());
  };

  const zoomIn = () => handleSetZoom(zoom + 2);
  const zoomOut = () => handleSetZoom(zoom - 2);

  return { zoom, setZoom: handleSetZoom, zoomIn, zoomOut, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM };
}
