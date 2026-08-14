import type { User } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth from the signed session cookie, never from the body. */
      user?: User;
    }
  }
}

export {};
