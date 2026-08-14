import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SIGNATURE_HEADER = "x-lakeside-signature";

/** Deliveries older than this are refused, so a captured request cannot be replayed later. */
export const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Signature format: `t=<unix millis>,v1=<hex hmac>`, where the HMAC covers
 * `<timestamp>.<raw body>`. Signing the timestamp together with the exact bytes
 * received means neither the payload nor its age can be altered in transit.
 */
export function signPayload(rawBody: string, secret: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function parseHeader(header: string): { timestamp: number; digest: string } | null {
  const parts = new Map<string, string>();
  for (const segment of header.split(",")) {
    const [key, value] = segment.split("=");
    if (key && value) parts.set(key.trim(), value.trim());
  }

  const timestamp = Number(parts.get("t"));
  const digest = parts.get("v1");
  if (!digest || !Number.isFinite(timestamp)) return null;

  return { timestamp, digest };
}

export type VerificationFailure = "missing" | "malformed" | "stale" | "mismatch";

export function verifySignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  now: number = Date.now(),
): VerificationFailure | null {
  if (!header) return "missing";

  const parsed = parseHeader(header);
  if (!parsed) return "malformed";

  if (Math.abs(now - parsed.timestamp) > SIGNATURE_TOLERANCE_MS) return "stale";

  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${parsed.timestamp}.${rawBody}`).digest("hex"),
    "hex",
  );
  const actual = Buffer.from(parsed.digest, "hex");

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return "mismatch";

  return null;
}
