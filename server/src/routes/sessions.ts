import { Router } from "express";
import type { Db } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { getBoardEntryForUser, listSessionsForUser } from "../sessions/service.js";

export function sessionsRouter(db: Db): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.get("/", (req, res) => {
    res.json({ sessions: listSessionsForUser(db, req.user!) });
  });

  router.get("/:id", (req, res) => {
    res.json({ session: getBoardEntryForUser(db, req.user!, req.params.id) });
  });

  return router;
}
