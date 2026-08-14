import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { HttpError } from "../types.js";
import { requireAuth } from "../auth/middleware.js";
import { getNoteView, transitionNote, updateNoteContent } from "../notes/service.js";

// expectedVersion is required: a client that cannot say which version it edited
// cannot be allowed to overwrite a note it may never have seen.
const patchSchema = z.object({
  content: z.string().max(20_000),
  expectedVersion: z.number().int().nonnegative(),
});

const transitionSchema = z.object({
  to: z.enum(["draft", "ready", "finalized"]),
});

export function notesRouter(db: Db): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.get("/:id", (req, res) => {
    res.json(getNoteView(db, req.user!, req.params.id));
  });

  router.patch("/:id", (req, res, next) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new HttpError(
          400,
          "invalid_request",
          "A save needs note content and the version it was based on.",
        ),
      );
      return;
    }

    res.json(
      updateNoteContent(
        db,
        req.user!,
        req.params.id,
        parsed.data.content,
        parsed.data.expectedVersion,
      ),
    );
  });

  router.post("/:id/transition", (req, res, next) => {
    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new HttpError(400, "invalid_request", "Unknown note status."));
      return;
    }

    res.json(transitionNote(db, req.user!, req.params.id, parsed.data.to));
  });

  return router;
}
