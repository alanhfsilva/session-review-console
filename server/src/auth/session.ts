import type { Request, Response } from "express";

const COOKIE_NAME = "lakeside_sid";

/** Absolute session lifetime. Clinical sessions should not live indefinitely. */
const MAX_AGE_MS = 8 * 60 * 60 * 1000;

/**
 * Local-only demo default. A real deployment injects SESSION_SECRET from a
 * secrets manager; the fallback exists so `npm run dev` needs no setup.
 */
export function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? "lakeside-local-dev-secret";
}

export function issueSession(res: Response, userId: string): void {
  res.cookie(COOKIE_NAME, `${userId}|${Date.now()}`, {
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

/** Returns the user id from a signed, unexpired cookie, or null. Fails closed. */
export function readSessionUserId(req: Request): string | null {
  const raw: unknown = req.signedCookies?.[COOKIE_NAME];
  if (typeof raw !== "string") return null;

  const [userId, issuedAt] = raw.split("|");
  if (!userId || !issuedAt) return null;

  const issued = Number(issuedAt);
  if (!Number.isFinite(issued) || Date.now() - issued > MAX_AGE_MS) return null;

  return userId;
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}
