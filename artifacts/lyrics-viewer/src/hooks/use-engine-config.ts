import { useEffect, useState } from "react";

interface EngineConfig {
  acrcloudEnabled: boolean;
  lyricSearchEnabled: boolean;
}

export function useEngineConfig(): EngineConfig {
  const [config, setConfig] = useState<EngineConfig>({ acrcloudEnabled: false, lyricSearchEnabled: false });
  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}api/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data === "object") {
          setConfig({
            acrcloudEnabled: Boolean(data.acrcloudEnabled),
            lyricSearchEnabled: Boolean(data.lyricSearchEnabled),
          });
        }
      })
      .catch(() => { /* default to all-false */ });
    return () => { cancelled = true; };
  }, []);
  return config;
}
