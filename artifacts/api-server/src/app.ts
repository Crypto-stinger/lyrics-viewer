import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { mountWebApp, redirectWww } from "./lib/web-app";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Behind Render / other hosts' load balancers, trust X-Forwarded-* so
// req.ip, req.protocol and rate limiting see the real client.
app.set("trust proxy", 1);
app.use(redirectWww);

// Clerk proxy must be mounted before body parsers — it streams raw bytes
// for the Clerk frontend SDK to talk to Clerk's backend through our domain.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Clerk session middleware — resolves publishable key from request host so
// the same server can serve multiple custom domains. Falls back to env var
// when host doesn't map to a custom Clerk domain.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      (getClerkProxyHost(req) ?? "").replace(/^www\./, ""),
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

// When running as a single service (Render etc.), also serve the web app.
mountWebApp(app);

export default app;
