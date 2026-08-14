import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import type { Db } from "./db.js";
import { HttpError } from "./types.js";
import { sessionSecret } from "./auth/session.js";
import { authRouter } from "./routes/auth.js";
import { sessionsRouter } from "./routes/sessions.js";

/**
 * Maps domain errors to responses. Anything unrecognised becomes a generic 500:
 * stack traces and SQL text must never reach a clinical client.
 */
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  console.error("unhandled request error:", err instanceof Error ? err.message : "unknown");
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong." } });
};

export function createApp(db: Db) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser(sessionSecret()));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter(db));
  app.use("/api/sessions", sessionsRouter(db));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found." } });
  });

  app.use(errorHandler);

  return app;
}
