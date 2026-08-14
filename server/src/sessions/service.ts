import { queryAll, queryOne, type Db } from "../db.js";
import { HttpError, type NoteStatus, type Session, type User } from "../types.js";
import { canViewSession, isElevated } from "../auth/rbac.js";

interface SessionRow {
  id: string;
  host_email: string | null;
  scheduled_at: string;
  duration_minutes: number;
  patient_initials: string;
  service_type: string;
  external_appt_id: string | null;
}

interface BoardRow extends SessionRow {
  host_name: string | null;
  note_id: string | null;
  note_status: NoteStatus | null;
  note_updated_at: string | null;
}

export interface BoardEntry extends Session {
  hostName: string | null;
  note: { id: string; status: NoteStatus; updatedAt: string } | null;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    hostEmail: row.host_email,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    patientInitials: row.patient_initials,
    serviceType: row.service_type,
    externalApptId: row.external_appt_id,
  };
}

const BOARD_SELECT = `
  SELECT s.*,
         u.name       AS host_name,
         n.id         AS note_id,
         n.status     AS note_status,
         n.updated_at AS note_updated_at
    FROM sessions s
    LEFT JOIN users u ON u.email = s.host_email
    LEFT JOIN notes n ON n.session_id = s.id
`;

function toBoardEntry(row: BoardRow): BoardEntry {
  return {
    ...toSession(row),
    hostName: row.host_name,
    note:
      row.note_id && row.note_status && row.note_updated_at
        ? { id: row.note_id, status: row.note_status, updatedAt: row.note_updated_at }
        : null,
  };
}

/**
 * The role filter is applied in SQL, so a clinician's rows never leave the
 * database in the first place.
 */
export function listSessionsForUser(db: Db, user: User): BoardEntry[] {
  const rows = isElevated(user)
    ? queryAll<BoardRow>(db, `${BOARD_SELECT} ORDER BY s.scheduled_at DESC`)
    : queryAll<BoardRow>(
        db,
        `${BOARD_SELECT} WHERE s.host_email = ? ORDER BY s.scheduled_at DESC`,
        user.email,
      );

  return rows.map(toBoardEntry);
}

export function findSessionById(db: Db, id: string): Session | null {
  const row = queryOne<SessionRow>(db, `SELECT * FROM sessions WHERE id = ?`, id);
  return row ? toSession(row) : null;
}

/**
 * Missing and forbidden both answer 404: a clinician must not be able to probe
 * which session ids exist elsewhere in the practice.
 */
export function getSessionForUser(db: Db, user: User, id: string): Session {
  const session = findSessionById(db, id);
  if (!session || !canViewSession(user, session)) {
    throw new HttpError(404, "not_found", "Session not found.");
  }
  return session;
}

export function getBoardEntryForUser(db: Db, user: User, id: string): BoardEntry {
  getSessionForUser(db, user, id);
  const row = queryOne<BoardRow>(db, `${BOARD_SELECT} WHERE s.id = ?`, id);
  if (!row) throw new HttpError(404, "not_found", "Session not found.");
  return toBoardEntry(row);
}
