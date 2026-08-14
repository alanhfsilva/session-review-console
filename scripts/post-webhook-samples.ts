import { signPayload, WEBHOOK_SIGNATURE_HEADER } from "../server/src/webhooks/verify.js";
import { webhookSecret } from "../server/src/webhooks/secret.js";

/**
 * Posts a representative run of scheduling events at a running console:
 * a delivery that links, one that cannot, a retry, a reschedule and a cancel.
 */
const target = process.env.WEBHOOK_TARGET ?? "http://127.0.0.1:4001";
const endpoint = `${target}/api/webhooks/appointments`;
const secret = webhookSecret();

interface Sample {
  label: string;
  expected: string;
  payload: unknown;
}

const linkedEvent = {
  eventId: "evt_demo_001",
  type: "appointment.created",
  occurredAt: "2026-08-09T09:00:00.000Z",
  appointment: {
    id: "appt_seed_001",
    status: "scheduled",
    clinicianEmail: "jordan.lee@lakeside.example",
    scheduledAt: "2026-08-10T14:00:00.000Z",
    durationMinutes: 50,
    patientInitials: "M.T.",
    serviceType: "Individual therapy",
  },
};

const samples: Sample[] = [
  {
    label: "created, matches a seeded session",
    expected: "linked",
    payload: linkedEvent,
  },
  {
    label: "same delivery retried by the vendor",
    expected: "duplicate",
    payload: linkedEvent,
  },
  {
    label: "created for an appointment no session claims",
    expected: "unmatched",
    payload: {
      eventId: "evt_demo_002",
      type: "appointment.created",
      occurredAt: "2026-08-14T08:30:00.000Z",
      appointment: {
        id: "appt_walkin_501",
        status: "scheduled",
        clinicianEmail: "sam.rivera@lakeside.example",
        scheduledAt: "2026-08-17T15:00:00.000Z",
        durationMinutes: 50,
        patientInitials: "H.G.",
        serviceType: "Intake assessment",
      },
    },
  },
  {
    label: "rescheduled to a later slot",
    expected: "unmatched",
    payload: {
      eventId: "evt_demo_003",
      type: "appointment.updated",
      occurredAt: "2026-08-14T09:15:00.000Z",
      appointment: {
        id: "appt_walkin_501",
        status: "rescheduled",
        clinicianEmail: "sam.rivera@lakeside.example",
        scheduledAt: "2026-08-18T16:00:00.000Z",
        durationMinutes: 50,
        patientInitials: "H.G.",
        serviceType: "Intake assessment",
      },
    },
  },
  {
    label: "cancelled by the practice",
    expected: "linked",
    payload: {
      eventId: "evt_demo_004",
      type: "appointment.cancelled",
      occurredAt: "2026-08-14T10:00:00.000Z",
      appointment: {
        id: "appt_seed_002",
        status: "cancelled",
        clinicianEmail: "jordan.lee@lakeside.example",
        scheduledAt: "2026-08-11T15:00:00.000Z",
        durationMinutes: 50,
        patientInitials: "R.K.",
        serviceType: "Individual therapy",
      },
    },
  },
];

async function post(body: string, signature: string): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", [WEBHOOK_SIGNATURE_HEADER]: signature },
    body,
  });
}

async function main(): Promise<void> {
  console.log(`Posting sample appointment events to ${endpoint}\n`);

  for (const sample of samples) {
    const body = JSON.stringify(sample.payload);
    const res = await post(body, signPayload(body, secret, Date.now()));
    const json: unknown = await res.json().catch(() => null);
    const result = (json as { result?: string } | null)?.result ?? "no result";

    const ok = res.status === 200 && result === sample.expected;
    console.log(
      `${ok ? "ok  " : "WARN"} ${sample.label}\n     ${res.status} ${result} (expected ${sample.expected})`,
    );
  }

  // Same body, signed with the wrong secret: this is what a forged delivery looks like.
  const forged = JSON.stringify({
    eventId: "evt_demo_forged",
    type: "appointment.created",
    occurredAt: "2026-08-14T10:30:00.000Z",
    appointment: { id: "appt_forged_999", status: "scheduled" },
  });
  const rejected = await post(forged, signPayload(forged, "wrong-secret", Date.now()));
  console.log(
    `${rejected.status === 401 ? "ok  " : "WARN"} forged signature rejected\n     ${rejected.status} (expected 401)`,
  );

  console.log("\nSign in as avery.kim@lakeside.example to see the unmatched queue.");
}

main().catch((error: unknown) => {
  console.error("Could not reach the console. Is `npm run dev` running?");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
