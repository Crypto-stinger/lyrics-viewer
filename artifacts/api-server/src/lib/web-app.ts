import express, { type Express, type Request, type Response, type NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

/**
 * Serve the built web app (artifacts/lyrics-viewer/dist/public) from this same
 * server, so the whole of Lyra runs as ONE service on any Node host (Render,
 * Railway, a VPS…). On Replit the web app is served separately, so this is
 * only switched on when SERVE_WEB=true.
 */
export function mountWebApp(app: Express): void {
  if (process.env.SERVE_WEB !== "true") return;

  const dir = path.resolve(
    process.env.WEB_DIST_DIR ?? path.join(process.cwd(), "artifacts/lyrics-viewer/dist/public"),
  );
  const indexHtml = path.join(dir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    logger.error({ dir }, "SERVE_WEB=true but the web build was not found — run the web build first");
    return;
  }

  // Hashed build files never change, so browsers may cache them for a year.
  // index.html and the service worker must always be re-checked, or users
  // would be stuck on an old version of the app.
  app.use(
    express.static(dir, {
      index: false,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        if (name === "index.html" || name === "sw.js" || name.startsWith("workbox-") || name.endsWith(".webmanifest")) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  // Single-page app: any other GET that isn't the API gets index.html, and
  // the app's own router decides what to show (including sign-in return pages).
  app.get(/^(?!\/api(?:\/|$)).*/, (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml);
  });

  logger.info({ dir }, "Serving web app");
}

/**
 * Send www.<domain> to the bare domain. Sign-in is tied to the bare domain, so
 * mixing the two breaks Google login. Only active when SERVE_WEB=true.
 */
export function redirectWww(req: Request, res: Response, next: NextFunction): void {
  if (process.env.SERVE_WEB !== "true") return next();
  const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() || req.headers.host || "";
  if (host.startsWith("www.") && req.path !== "/api/healthz") {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || "https";
    res.redirect(301, `${proto}://${host.slice(4)}${req.originalUrl}`);
    return;
  }
  next();
}
