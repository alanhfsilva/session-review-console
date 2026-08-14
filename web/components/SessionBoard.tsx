"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError, type BoardEntry } from "../lib/api-client";
import { useAuth } from "../lib/auth-context";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime, formatDuration } from "../lib/format";

export function SessionBoard() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<BoardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.sessions();
      setSessions(res.sessions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the board.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showClinician = user?.role !== "clinician";

  if (error) {
    return (
      <section className="card">
        <p className="banner banner-error" role="alert">
          {error}
        </p>
        <button type="button" onClick={() => void load()}>
          Try again
        </button>
      </section>
    );
  }

  if (!sessions) {
    return <p className="muted">Loading sessions...</p>;
  }

  if (sessions.length === 0) {
    return (
      <section className="card">
        <h2>No sessions yet</h2>
        <p className="muted">
          Sessions you host appear here once the recording system has processed them.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="board-heading">
      <div className="section-head">
        <h1 id="board-heading">Session board</h1>
        <p className="muted">
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
          {showClinician ? " across the practice" : ""}
        </p>
      </div>

      <ul className="board">
        {sessions.map((session) => (
          <li key={session.id} className="board-row card">
            <div className="board-when">
              <span className="board-time">{formatDateTime(session.scheduledAt)}</span>
              <span className="muted">{formatDuration(session.durationMinutes)}</span>
            </div>

            <div className="board-who">
              <span className="board-initials">{session.patientInitials}</span>
              <span className="muted">{session.serviceType}</span>
              {showClinician && (
                <span className="muted">
                  {session.hostName ?? "Unassigned clinician"}
                </span>
              )}
            </div>

            <div className="board-status">
              <StatusBadge status={session.note?.status ?? null} />
            </div>

            <div className="board-action">
              {session.note ? (
                <Link className="button-link" href={`/notes/${session.note.id}`}>
                  Open note
                </Link>
              ) : (
                <span className="muted">Note not drafted</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
