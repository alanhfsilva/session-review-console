import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Demo-only credential. The brief allows a documented password map instead of a
 * real identity provider; every seeded user shares this password. It is stored
 * salted and hashed so no plaintext credential ever lands in the database.
 */
export const DEMO_PASSWORD = "lakeside-demo";

const KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/**
 * Verified against when no user matches the submitted email, so a sign-in
 * attempt costs the same whether or not the address belongs to staff. Without
 * it, response times alone disclose which clinicians have accounts.
 */
export const DUMMY_PASSWORD_HASH = hashPassword("no-account-for-this-address");

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
