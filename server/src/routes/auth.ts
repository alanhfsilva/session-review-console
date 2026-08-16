import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { HttpError } from "../types.js";
import { findUserCredentialsByEmail } from "../users/repository.js";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "../auth/passwords.js";
import { clearSession, issueSession } from "../auth/session.js";
import { requireAuth } from "../auth/middleware.js";

const loginSchema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(200),
});

export function authRouter(db: Db): Router {
  const router = Router();

  router.post("/login", (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new HttpError(400, "invalid_request", "Email and password are required."));
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const found = findUserCredentialsByEmail(db, email);

    // One generic failure for unknown email and wrong password, and the hash
    // runs either way: neither the response body nor the time it takes may
    // tell an attacker which staff addresses exist.
    const hash = found?.passwordHash ?? DUMMY_PASSWORD_HASH;
    if (!verifyPassword(parsed.data.password, hash) || !found) {
      next(new HttpError(401, "invalid_credentials", "Email or password is incorrect."));
      return;
    }

    issueSession(res, found.user.id);
    res.json({ user: found.user });
  });

  router.post("/logout", (_req, res) => {
    clearSession(res);
    res.status(204).end();
  });

  router.get("/me", requireAuth(db), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
