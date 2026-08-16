import { beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import { createTestContext, loginAs, USERS, type TestContext } from "./helpers.js";
import { signPayload, WEBHOOK_SIGNATURE_HEADER } from "../server/src/webhooks/verify.js";
import { webhookSecret } from "../server/src/webhooks/secret.js";
import { handleAppointmentEvent } from "../server/src/webhooks/service.js";
import { appointmentEventSchema } from "../server/src/webhooks/types.js";
import { queryAll, queryOne } from "../server/src/db.js";

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

interface EventOptions {
  eventId?: string;
  type?: string;
  apptId?: string;
  status?: string;
  clinicianEmail?: string;
  scheduledAt?: string;
  occurredAt?: string;
}

function buildEvent(options: EventOptions = {}) {
  return {
    eventId: options.eventId ?? "evt_001",
    type: options.type ?? "appointment.created",
    occurredAt: options.occurredAt ?? "2026-08-14T12:00:00.000Z",
    appointment: {
      id: options.apptId ?? "appt_seed_001",
      status: options.status ?? "scheduled",
      clinicianEmail: options.clinicianEmail ?? USERS.jordan,
      scheduledAt: options.scheduledAt ?? "2026-08-10T14:00:00.000Z",
      durationMinutes: 50,
      patientInitials: "M.T.",
      serviceType: "Individual therapy",
    },
  };
}

function post(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  const req = request(ctx.app)
    .post("/api/webhooks/appointments")
    .set("Content-Type", "application/json");

  const header = signature ?? signPayload(body, webhookSecret(), Date.now());
  return req.set(WEBHOOK_SIGNATURE_HEADER, header).send(body);
}

function appointmentCount(id: string): number {
  const row = queryOne<{ count: number }>(
    ctx.db,
    `SELECT COUNT(*) AS count FROM appointments WHERE id = ?`,
    id,
  );
  return row?.count ?? 0;
}

function appointment(id: string) {
  return queryOne<{
    id: string;
    status: string;
    session_id: string | null;
    unmatched: number;
    scheduled_at: string | null;
  }>(ctx.db, `SELECT * FROM appointments WHERE id = ?`, id);
}

describe("authenticity", () => {
  test("rejects an unsigned delivery and stores nothing", async () => {
    const body = JSON.stringify(buildEvent());
    const res = await request(ctx.app)
      .post("/api/webhooks/appointments")
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
    expect(appointmentCount("appt_seed_001")).toBe(0);
  });

  test("rejects a signature made with the wrong secret", async () => {
    const body = JSON.stringify(buildEvent());
    const res = await post(buildEvent(), signPayload(body, "not-our-secret", Date.now()));

    expect(res.status).toBe(401);
    expect(appointmentCount("appt_seed_001")).toBe(0);
  });

  test("rejects a signature that does not cover the delivered body", async () => {
    const signedFor = JSON.stringify(buildEvent({ apptId: "appt_seed_001" }));
    const tampered = buildEvent({ apptId: "appt_injected" });

    const res = await post(tampered, signPayload(signedFor, webhookSecret(), Date.now()));

    expect(res.status).toBe(401);
    expect(appointmentCount("appt_injected")).toBe(0);
  });

  test("rejects a replayed delivery outside the timestamp window", async () => {
    const body = JSON.stringify(buildEvent());
    const oldTimestamp = Date.now() - 30 * 60 * 1000;

    const res = await post(buildEvent(), signPayload(body, webhookSecret(), oldTimestamp));

    expect(res.status).toBe(401);
    expect(appointmentCount("appt_seed_001")).toBe(0);
  });
});

describe("payload validation", () => {
  test("rejects a body that is not the documented shape", async () => {
    const res = await post({ eventId: "evt_bad", type: "appointment.created" });
    expect(res.status).toBe(400);
  });

  test("rejects an unknown event type", async () => {
    const res = await post(buildEvent({ type: "appointment.exploded" }));
    expect(res.status).toBe(400);
  });
});

describe("linking", () => {
  test("links an appointment to the session that carries its id", async () => {
    const res = await post(buildEvent());

    expect(res.status).toBe(200);
    expect(res.body.result).toBe("linked");
    expect(appointment("appt_seed_001")?.session_id).toBe("sess_001");
    expect(appointment("appt_seed_001")?.unmatched).toBe(0);
  });

  test("keeps an appointment with no matching session in the unmatched queue", async () => {
    const res = await post(buildEvent({ eventId: "evt_orphan", apptId: "appt_unknown_999" }));

    expect(res.status).toBe(200);
    expect(res.body.result).toBe("unmatched");
    expect(appointment("appt_unknown_999")?.unmatched).toBe(1);
    expect(appointment("appt_unknown_999")?.session_id).toBeNull();
  });

  test("does not touch clinical note content", async () => {
    const before = queryAll<{ content: string }>(ctx.db, `SELECT content FROM notes ORDER BY id`);
    await post(buildEvent());
    const after = queryAll<{ content: string }>(ctx.db, `SELECT content FROM notes ORDER BY id`);

    expect(after).toEqual(before);
  });
});

describe("idempotency", () => {
  test("processes a repeated event id exactly once", async () => {
    const event = buildEvent({ eventId: "evt_dup" });

    const first = await post(event);
    const second = await post(event);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.result).toBe("duplicate");
    expect(appointmentCount("appt_seed_001")).toBe(1);
  });

  test("a redelivered cancellation does not resurrect or double-apply", async () => {
    await post(buildEvent({ eventId: "evt_create" }));
    const cancel = buildEvent({
      eventId: "evt_cancel",
      type: "appointment.cancelled",
      status: "cancelled",
    });

    await post(cancel);
    await post(cancel);

    expect(appointment("appt_seed_001")?.status).toBe("cancelled");
    expect(appointmentCount("appt_seed_001")).toBe(1);
  });
});

describe("failed processing", () => {
  test("a delivery that fails partway is not recorded as processed", () => {
    // Fault injection: the appointments write is made to fail so the handler
    // throws mid-transaction. The vendor retries on our 500, and that retry
    // must find no ledger entry, otherwise the event is lost for good.
    ctx.db.exec(`DROP TABLE appointments`);

    const event = appointmentEventSchema.parse(buildEvent({ eventId: "evt_boom" }));
    expect(() => handleAppointmentEvent(ctx.db, event)).toThrow();

    const recorded = queryOne<{ count: number }>(
      ctx.db,
      `SELECT COUNT(*) AS count FROM webhook_events WHERE event_id = ?`,
      "evt_boom",
    );
    expect(recorded?.count).toBe(0);
  });
});

describe("updates and cancellations", () => {
  test("applies a rescheduled time to the stored appointment", async () => {
    await post(buildEvent({ eventId: "evt_create" }));
    await post(
      buildEvent({
        eventId: "evt_update",
        type: "appointment.updated",
        scheduledAt: "2026-08-19T19:30:00.000Z",
      }),
    );

    expect(appointment("appt_seed_001")?.scheduled_at).toBe("2026-08-19T19:30:00.000Z");
  });

  test("a create delivered after a cancellation does not resurrect the appointment", async () => {
    await post(
      buildEvent({
        eventId: "evt_cancel_first",
        type: "appointment.cancelled",
        status: "cancelled",
        apptId: "appt_order_1",
        occurredAt: "2026-08-14T13:00:00.000Z",
      }),
    );

    const late = await post(
      buildEvent({
        eventId: "evt_create_late",
        type: "appointment.created",
        status: "scheduled",
        apptId: "appt_order_1",
        occurredAt: "2026-08-14T12:00:00.000Z",
      }),
    );

    expect(late.status).toBe(200);
    expect(late.body.result).toBe("ignored");
    expect(appointment("appt_order_1")?.status).toBe("cancelled");
  });

  test("a stale delivery is still recorded so the vendor stops retrying it", async () => {
    await post(
      buildEvent({ eventId: "evt_new", occurredAt: "2026-08-14T13:00:00.000Z" }),
    );
    const stale = buildEvent({ eventId: "evt_old", occurredAt: "2026-08-14T11:00:00.000Z" });

    expect((await post(stale)).body.result).toBe("ignored");
    expect((await post(stale)).body.result).toBe("duplicate");
  });

  test("rejects a cancellation whose appointment still says scheduled", async () => {
    const res = await post(
      buildEvent({ eventId: "evt_mismatch", type: "appointment.cancelled", status: "scheduled" }),
    );

    expect(res.status).toBe(400);
    expect(appointmentCount("appt_seed_001")).toBe(0);
  });

  test("rejects a create that carries a cancelled appointment", async () => {
    const res = await post(
      buildEvent({ eventId: "evt_mismatch_2", type: "appointment.created", status: "cancelled" }),
    );

    expect(res.status).toBe(400);
    expect(appointmentCount("appt_seed_001")).toBe(0);
  });

  test("a cancellation keeps the link and the history rather than deleting rows", async () => {
    await post(buildEvent({ eventId: "evt_create" }));
    await post(
      buildEvent({ eventId: "evt_cancel", type: "appointment.cancelled", status: "cancelled" }),
    );

    const row = appointment("appt_seed_001");
    expect(row?.status).toBe("cancelled");
    expect(row?.session_id).toBe("sess_001");
  });
});

describe("operator queue", () => {
  test("a clinician cannot see the practice-wide unmatched queue", async () => {
    await post(buildEvent({ eventId: "evt_orphan", apptId: "appt_unknown_999" }));

    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.get("/api/appointments/unmatched");

    expect(res.status).toBe(403);
  });

  test("a supervisor sees unmatched appointments", async () => {
    await post(buildEvent({ eventId: "evt_orphan", apptId: "appt_unknown_999" }));

    const agent = await loginAs(ctx.app, USERS.supervisor);
    const res = await agent.get("/api/appointments/unmatched");

    expect(res.status).toBe(200);
    const ids: string[] = res.body.appointments.map((a: { id: string }) => a.id);
    expect(ids).toContain("appt_unknown_999");
  });

  test("an admin can attach an unmatched appointment to a session, with an audit trail", async () => {
    await post(buildEvent({ eventId: "evt_orphan", apptId: "appt_unknown_999" }));

    const agent = await loginAs(ctx.app, USERS.admin);
    const res = await agent
      .post("/api/appointments/appt_unknown_999/link")
      .send({ sessionId: "sess_008" });

    expect(res.status).toBe(200);
    expect(appointment("appt_unknown_999")?.session_id).toBe("sess_008");
    expect(appointment("appt_unknown_999")?.unmatched).toBe(0);

    const audit = queryAll<{ actor_user_id: string; type: string }>(
      ctx.db,
      `SELECT * FROM appointment_events WHERE appointment_id = ?`,
      "appt_unknown_999",
    );
    expect(audit.some((e) => e.type === "linked" && e.actor_user_id === "user_adm_1")).toBe(true);
  });

  test("refuses to attach an appointment that is already linked", async () => {
    await post(buildEvent({ eventId: "evt_orphan", apptId: "appt_unknown_999" }));
    const agent = await loginAs(ctx.app, USERS.admin);
    await agent.post("/api/appointments/appt_unknown_999/link").send({ sessionId: "sess_008" });

    const second = await agent
      .post("/api/appointments/appt_unknown_999/link")
      .send({ sessionId: "sess_003" });

    expect(second.status).toBe(409);
    expect(appointment("appt_unknown_999")?.session_id).toBe("sess_008");
  });

  test("never leaves two sessions claiming the same vendor appointment id", async () => {
    await post(buildEvent({ eventId: "evt_orphan", apptId: "appt_unknown_999" }));
    const agent = await loginAs(ctx.app, USERS.admin);
    const res = await agent
      .post("/api/appointments/appt_unknown_999/link")
      .send({ sessionId: "sess_008" });

    expect(res.status).toBe(200);

    const claimed = queryAll<{ id: string }>(
      ctx.db,
      `SELECT id FROM sessions WHERE external_appt_id = ?`,
      "appt_unknown_999",
    );
    expect(claimed.map((row) => row.id)).toEqual(["sess_008"]);
  });

  test("a clinician cannot attach an appointment to a session", async () => {
    await post(buildEvent({ eventId: "evt_orphan", apptId: "appt_unknown_999" }));

    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent
      .post("/api/appointments/appt_unknown_999/link")
      .send({ sessionId: "sess_003" });

    expect(res.status).toBe(403);
    expect(appointment("appt_unknown_999")?.session_id).toBeNull();
  });
});
