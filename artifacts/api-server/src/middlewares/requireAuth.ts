import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware that fails the request with 401 unless Clerk sees a
 * valid session. On success, attaches `req.userId` so downstream handlers
 * can scope their queries by user without re-running getAuth(req).
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId as string | undefined ?? auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
