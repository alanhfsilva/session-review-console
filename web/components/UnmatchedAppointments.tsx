"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type BoardEntry, type UnmatchedAppointment } from "../lib/api-client";
import { formatDateTime } from "../lib/format";

export function UnmatchedAppointments() {
  const [appointments, setAppointments] = useState<UnmatchedAppointment[] | null>(null);
  const [sessions, setSessions] = useState<BoardEntry[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [queue, board] = await Promise.all([api.unmatchedAppointments(), api.sessions()]);
      setAppointments(queue.appointments);
      setSessions(board.sessions.filter((s) => s.externalApptId === null));
      setChoice(
        Object.fromEntries(
          queue.appointments.map((a) => [a.id, a.suggestedSessionId ?? ""]),
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? "Only supervisors and administrators can resolve scheduling gaps."
          : err instanceof ApiError
            ? err.message
            : "Could not load the queue.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function link(appointmentId: string) {
    const sessionId = choice[appointmentId];
    if (!sessionId) return;

    setBusyId(appointmentId);
    setError(null);
    try {
      await api.linkAppointment(appointmentId, sessionId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not link that appointment.");
    } finally {
      setBusyId(null);
    }
  }

  if (error && !appointments) {
    return (
      <section className="card">
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      </section>
    );
  }

  if (!appointments) return <p className="muted">Loading scheduling queue...</p>;

  return (
    <section aria-labelledby="queue-heading">
      <div className="section-head">
        <h1 id="queue-heading">Unmatched appointments</h1>
        <p className="muted">
          Appointments the scheduling system sent that no session claims. Attach each one to the
          session it belongs to, or leave it here for the scheduler to correct.
        </p>
      </div>

      {error && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}

      {appointments.length === 0 ? (
        <div className="card">
          <h2>Nothing waiting</h2>
          <p className="muted">Every appointment received is attached to a session.</p>
        </div>
      ) : (
        <ul className="board">
          {appointments.map((appointment) => (
            <li key={appointment.id} className="card">
              <div className="board-who">
                <span className="board-initials">{appointment.patientInitials ?? "Unknown"}</span>
                <span className="muted">{appointment.serviceType ?? "Unspecified service"}</span>
                <span className="muted">{appointment.status}</span>
              </div>
              <p className="muted">
                {appointment.scheduledAt ? formatDateTime(appointment.scheduledAt) : "No time given"}
                {appointment.clinicianEmail ? ` - ${appointment.clinicianEmail}` : ""}
              </p>
              <p className="muted">Vendor id {appointment.id}</p>

              <label htmlFor={`session-${appointment.id}`}>Attach to session</label>
              <select
                id={`session-${appointment.id}`}
                value={choice[appointment.id] ?? ""}
                onChange={(e) =>
                  setChoice((prev) => ({ ...prev, [appointment.id]: e.target.value }))
                }
              >
                <option value="">Select a session</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {formatDateTime(session.scheduledAt)} - {session.patientInitials} -{" "}
                    {session.hostName ?? "Unassigned"}
                  </option>
                ))}
              </select>
              {appointment.suggestedSessionId && (
                <p className="muted">
                  Suggested: a session with the same clinician and start time is preselected. Confirm
                  before attaching.
                </p>
              )}

              <button
                type="button"
                onClick={() => void link(appointment.id)}
                disabled={busyId === appointment.id || !choice[appointment.id]}
              >
                {busyId === appointment.id ? "Attaching..." : "Attach to session"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
