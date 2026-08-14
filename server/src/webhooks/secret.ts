/**
 * Demo-only shared secret for the scheduling vendor. Documented in the README
 * so the sample script can sign requests; a real deployment injects
 * WEBHOOK_SECRET and rotates it with the vendor.
 */
export const DEMO_WEBHOOK_SECRET = "lakeside-webhook-dev";

export function webhookSecret(): string {
  const configured = process.env.WEBHOOK_SECRET;
  if (configured) return configured;

  // Fail closed rather than accept vendor traffic signed with a published secret.
  if (process.env.NODE_ENV === "production") {
    throw new Error("WEBHOOK_SECRET must be set in production.");
  }
  return DEMO_WEBHOOK_SECRET;
}
