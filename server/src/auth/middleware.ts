import type { RequestHandler } from "express";
import type { Db } from "../db.js";
import { HttpError, type UserRole } from "../types.js";
import { findUserById } from "../users/repository.js";
import { readSessionUserId } from "./session.js";

/**
 * Resolves the caller from the signed cookie and loads the user fresh from the
 * database on every request, so a role never travels in client-controlled data.
 */
export function requireAuth(db: Db): RequestHandler {
  return (req, _res, next) => {
    const userId = readSessionUserId(req);
    if (!userId) {
      next(new HttpError(401, "unauthenticated", "Sign in to continue."));
      return;
    }

    const user = findUserById(db, userId);
    if (!user) {
      next(new HttpError(401, "unauthenticated", "Sign in to continue."));
      return;
    }

    req.user = user;
    next();
  };
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new HttpError(403, "forbidden", "Your role does not allow this action."));
      return;
    }
    next();
  };
}
