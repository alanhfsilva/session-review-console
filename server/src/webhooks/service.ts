import { randomUUID } from "node:crypto";
import { execute, inTransaction, queryAll, queryOne, type Db } from "../db.js";
import { HttpError, type Appointment, type User } from "../types.js";
import { canResolveAppointments } from "../auth/rbac.js";
import type { AppointmentEvent, HandleResult } from "./types.js";

/** Actor recorded for changes the scheduling vendor made, as opposed to staff. */
const WEBHOOK_ACTOR = "scheduling_webhook";

interface AppointmentRow {
  id: string;
  status: string;
  clinician_email: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  patient_initials: string | null;
  service_type: string | null;
  session_id: string | null;
  unmatched: number;
  updated_at: string;
}

export interface UnmatchedAppointment extends Appointment {
  suggestedSessionId: string | null;
}

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    status: row.status as Appointment["status"],
    clinicianEmail: row.clinician_email,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    patientInitials: row.patient_initials,
    serviceType: row.service_type,
    sessionId: row.session_id,
    unmatched: row.unmatched === 1,
    updatedAt: row.updated_at,
  };
}

function recordAppointmentEvent(
  db: Db,
  appointmentId: string,
  actorUserId: string,
  type: "received" | "linked" | "unmatched",
  detail: string | null,
  at: string,
): void {
  execute(
    db,
    `INSERT INTO appointment_events (id, appointment_id, actor_user_id, type, detail, at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    appointmentId,
    actorUserId,
    type,
    detail,
    at,
  );
}

/**
 * Applies one delivery from the scheduling vendor.
 *
 * The event id is the idempotency key: a redelivery (vendors retry on timeout)
 * is acknowledged without repeating any side effect. Appointments are stored as
 * a projection of vendor data and never write clinical note content.
 */
export function handleAppointmentEvent(db: Db, event: AppointmentEvent): HandleResult {
  const seen = queryOne<{ event_id: string }>(
    db,
    `SELECT event_id FROM webhook_events WHERE event_id = ?`,
    event.eventId,
  );
  if (seen) return "duplicate";

  const appt = event.appointment;
  const at = new Date().toISOString();

  return inTransaction(db, () => {
    const match = queryOne<{ id: string }>(
      db,
      `SELECT id FROM sessions WHERE external_appt_id = ?`,
      appt.id,
    );

    execute(
      db,
      `INSERT INTO appointments
         (id, status, clinician_email, scheduled_at, duration_minutes,
          patient_initials, service_type, session_id, unmatched, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status           = excluded.status,
         clinician_email  = excluded.clinician_email,
         scheduled_at     = excluded.scheduled_at,
         duration_minutes = excluded.duration_minutes,
         patient_initials = excluded.patient_initials,
         service_type     = excluded.service_type,
         -- A link an operator already made outlives later vendor updates.
         session_id       = COALESCE(appointments.session_id, excluded.session_id),
         unmatched        = CASE
                              WHEN COALESCE(appointments.session_id, excluded.session_id) IS NULL
                              THEN 1 ELSE 0
                            END,
         updated_at       = excluded.updated_at`,
      appt.id,
      appt.status,
      appt.clinicianEmail ?? null,
      appt.scheduledAt ?? null,
      appt.durationMinutes ?? null,
      appt.patientInitials ?? null,
      appt.serviceType ?? null,
      match?.id ?? null,
      match ? 0 : 1,
      at,
    );

    const stored = queryOne<AppointmentRow>(db, `SELECT * FROM appointments WHERE id = ?`, appt.id);
    const linked = stored?.session_id != null;

    recordAppointmentEvent(db, appt.id, WEBHOOK_ACTOR, "received", event.type, at);
    if (!linked) {
      recordAppointmentEvent(db, appt.id, WEBHOOK_ACTOR, "unmatched", "no session carries this id", at);
    }

    execute(
      db,
      `INSERT INTO webhook_events (event_id, type, appointment_id, received_at) VALUES (?, ?, ?, ?)`,
      event.eventId,
      event.type,
      appt.id,
      at,
    );

    return linked ? "linked" : "unmatched";
  });
}

export function listUnmatchedAppointments(db: Db, user: User): UnmatchedAppointment[] {
  if (!canResolveAppointments(user)) {
    throw new HttpError(403, "forbidden", "Only supervisors and admins resolve scheduling gaps.");
  }

  const rows = queryAll<AppointmentRow>(
    db,
    `SELECT * FROM appointments WHERE unmatched = 1 ORDER BY scheduled_at DESC`,
  );

  return rows.map((row) => {
    // A cautious hint only: same clinician, same start time, no appointment yet.
    const suggestion =
      row.clinician_email && row.scheduled_at
        ? queryOne<{ id: string }>(
            db,
            `SELECT id FROM sessions
              WHERE host_email = ? AND scheduled_at = ? AND external_appt_id IS NULL`,
            row.clinician_email,
            row.scheduled_at,
          )
        : undefined;

    return { ...toAppointment(row), suggestedSessionId: suggestion?.id ?? null };
  });
}

/** Operator action: attach an orphaned appointment to the session it belongs to. */
export function linkAppointmentToSession(
  db: Db,
  user: User,
  appointmentId: string,
  sessionId: string,
): Appointment {
  if (!canResolveAppointments(user)) {
    throw new HttpError(403, "forbidden", "Only supervisors and admins resolve scheduling gaps.");
  }

  const appointment = queryOne<AppointmentRow>(
    db,
    `SELECT * FROM appointments WHERE id = ?`,
    appointmentId,
  );
  if (!appointment) throw new HttpError(404, "not_found", "Appointment not found.");

  const session = queryOne<{ id: string; external_appt_id: string | null }>(
    db,
    `SELECT id, external_appt_id FROM sessions WHERE id = ?`,
    sessionId,
  );
  if (!session) throw new HttpError(404, "not_found", "Session not found.");

  if (session.external_appt_id && session.external_appt_id !== appointmentId) {
    throw new HttpError(
      409,
      "session_already_linked",
      "That session is already linked to a different appointment.",
    );
  }

  const at = new Date().toISOString();

  inTransaction(db, () => {
    execute(
      db,
      `UPDATE appointments SET session_id = ?, unmatched = 0, updated_at = ? WHERE id = ?`,
      sessionId,
      at,
      appointmentId,
    );
    execute(db, `UPDATE sessions SET external_appt_id = ? WHERE id = ?`, appointmentId, sessionId);
    recordAppointmentEvent(db, appointmentId, user.id, "linked", `session ${sessionId}`, at);
  });

  const updated = queryOne<AppointmentRow>(
    db,
    `SELECT * FROM appointments WHERE id = ?`,
    appointmentId,
  );
  return toAppointment(updated!);
}
