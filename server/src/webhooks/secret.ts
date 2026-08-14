/**
 * Demo-only shared secret for the scheduling vendor. Documented in the README
 * so the sample script can sign requests; a real deployment injects
 * WEBHOOK_SECRET and rotates it with the vendor.
 */
export const DEMO_WEBHOOK_SECRET = "lakeside-webhook-dev";

export function webhookSecret(): string {
  return process.env.WEBHOOK_SECRET ?? DEMO_WEBHOOK_SECRET;
}
