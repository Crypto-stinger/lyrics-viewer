import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

// PORT and BASE_PATH are wired by the workflow at runtime. During `pnpm run build`
// (invoked by publish) they're not set, so fall back to safe defaults so the
// config loads. The published static build is served from "/" by the deploy host.
const rawPort = process.env.PORT ?? "5173";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    // optimize:false — Tailwind v4's lightningcss optimizer reorders nested
    // @layer imports (used by @clerk/themes/shadcn.css), which works in dev
    // but breaks Clerk's UI styles in production builds.
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    // Lyra PWA: precaches the app shell so the UI loads offline; runtime-caches
    // lyrics + LRC fetches to third-party APIs so songs the singer has viewed
    // (or proactively warmed via favourites/setlists) work mid-gig without wifi.
    //
    // registerType: 'prompt' — never auto-reload (would be catastrophic mid-song).
    // We surface a non-intrusive update banner instead and let the user choose.
    VitePWA({
      registerType: "prompt",
      injectRegister: false, // we register via the React hook in <PwaStatus />
      includeAssets: [
        "favicon.svg",
        "pwa-icons/apple-touch-icon.png",
      ],
      manifest: {
        name: "Lyra — Live Lyrics for Performers",
        short_name: "Lyra",
        description:
          "Lyrics, setlists and song finder for singers, musicians and cover bands. Stage-friendly and works offline.",
        theme_color: "#0A0F1F",
        background_color: "#0A0F1F",
        display: "standalone",
        orientation: "any",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "pwa-icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "pwa-icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "pwa-icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
        // First install: no existing SW, so the new one activates immediately
        // and `clientsClaim` grabs control of the open page right away — that
        // way the precache hook's first-session lyric fetches actually go
        // through the SW and get cached. On updates, `skipWaiting` stays false
        // (default) so the new SW waits in the background until the user taps
        // "Reload" in our update banner — never forced mid-song.
        clientsClaim: true,
        // Only cache successful HTTP responses. lyrics.ovh returns 404 for songs
        // it doesn't know — we must NOT cache those, otherwise a future "this
        // song just got added" lookup would return the stale 404 forever.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.lyrics\.ovh\/v1\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "lyra-lyrics-ovh",
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 60 },
              matchOptions: { ignoreVary: true },
            },
          },
          {
            urlPattern: /^https:\/\/lrclib\.net\/api\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "lyra-lrclib",
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 60 },
              matchOptions: { ignoreVary: true },
            },
          },
        ],
      },
      // Service worker is built only for production. We tried enabling it in
      // dev and it caused painful cross-browser issues — Chrome served stale
      // cached CSS through old SW versions, and Firefox's stricter SW handling
      // broke the page entirely. The SW lives in production builds only:
      //   pnpm --filter @workspace/lyrics-viewer run build
      //   pnpm --filter @workspace/lyrics-viewer run serve
      devOptions: { enabled: false },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
