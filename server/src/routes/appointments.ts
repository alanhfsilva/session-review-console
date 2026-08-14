import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { HttpError } from "../types.js";
import { requireAuth } from "../auth/middleware.js";
import { linkAppointmentToSession, listUnmatchedAppointments } from "../webhooks/service.js";

const linkSchema = z.object({ sessionId: z.string().min(1).max(200) });

export function appointmentsRouter(db: Db): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.get("/unmatched", (req, res) => {
    res.json({ appointments: listUnmatchedAppointments(db, req.user!) });
  });

  router.post("/:id/link", (req, res, next) => {
    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new HttpError(400, "invalid_request", "A session id is required."));
      return;
    }

    res.json({
      appointment: linkAppointmentToSession(db, req.user!, req.params.id, parsed.data.sessionId),
    });
  });

  return router;
}
