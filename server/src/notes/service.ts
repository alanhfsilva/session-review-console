import { randomUUID } from "node:crypto";
import { execute, inTransaction, queryAll, queryOne, type Db } from "../db.js";
import {
  HttpError,
  type Note,
  type NoteEvent,
  type NoteEventType,
  type NoteStatus,
  type Session,
  type User,
} from "../types.js";
import { canEditNote, canViewSession } from "../auth/rbac.js";
import { findSessionById } from "../sessions/service.js";
import { allowedTransitions, assertCanTransition, assertEditable } from "./transitions.js";

interface NoteRow {
  id: string;
  session_id: string;
  status: NoteStatus;
  content: string;
  updated_at: string;
  version: number;
}

interface NoteEventRow {
  id: string;
  note_id: string;
  actor_user_id: string;
  actor_name: string | null;
  type: NoteEventType;
  from_status: NoteStatus | null;
  to_status: NoteStatus | null;
  at: string;
}

export interface NoteView {
  note: Note & { version: number };
  session: Session;
  history: NoteEvent[];
  permissions: {
    canEdit: boolean;
    allowedTransitions: readonly NoteStatus[];
  };
}

function toNote(row: NoteRow): Note & { version: number } {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    content: row.content,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function toEvent(row: NoteEventRow): NoteEvent {
  return {
    id: row.id,
    noteId: row.note_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    type: row.type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    at: row.at,
  };
}

function findNoteRow(db: Db, noteId: string): NoteRow | undefined {
  return queryOne<NoteRow>(db, `SELECT * FROM notes WHERE id = ?`, noteId);
}

/**
 * Loads a note together with the session that governs access to it. Both a
 * missing note and a note outside the caller's scope answer 404, so ids stay
 * unguessable across the practice.
 */
function loadReadable(db: Db, user: User, noteId: string): { row: NoteRow; session: Session } {
  const row = findNoteRow(db, noteId);
  const session = row ? findSessionById(db, row.session_id) : null;

  if (!row || !session || !canViewSession(user, session)) {
    throw new HttpError(404, "not_found", "Note not found.");
  }
  return { row, session };
}

/**
 * Read access is already proven by the time this runs, so a caller who may see
 * the note but not author it gets an explicit 403 rather than a false 404.
 */
function loadWritable(db: Db, user: User, noteId: string): { row: NoteRow; session: Session } {
  const loaded = loadReadable(db, user, noteId);
  if (!canEditNote(user, loaded.session)) {
    throw new HttpError(
      403,
      "forbidden",
      "Only the clinician who held the session can change this note.",
    );
  }
  return loaded;
}

function appendEvent(
  db: Db,
  params: {
    noteId: string;
    actorUserId: string;
    type: NoteEventType;
    fromStatus: NoteStatus | null;
    toStatus: NoteStatus | null;
    at: string;
  },
): void {
  execute(
    db,
    `INSERT INTO note_events (id, note_id, actor_user_id, type, from_status, to_status, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    params.noteId,
    params.actorUserId,
    params.type,
    params.fromStatus,
    params.toStatus,
    params.at,
  );
}

export function getNoteHistory(db: Db, noteId: string): NoteEvent[] {
  const rows = queryAll<NoteEventRow>(
    db,
    `SELECT e.*, u.name AS actor_name
       FROM note_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.note_id = ?
      ORDER BY e.at ASC, e.rowid ASC`,
    noteId,
  );
  return rows.map(toEvent);
}

export function getNoteView(db: Db, user: User, noteId: string): NoteView {
  const { row, session } = loadReadable(db, user, noteId);
  const editable = canEditNote(user, session);

  return {
    note: toNote(row),
    session,
    history: getNoteHistory(db, noteId),
    permissions: {
      canEdit: editable && row.status !== "finalized",
      allowedTransitions: editable ? allowedTransitions(row.status) : [],
    },
  };
}

export function findNoteIdForSession(db: Db, sessionId: string): string | null {
  const row = queryOne<{ id: string }>(db, `SELECT id FROM notes WHERE session_id = ?`, sessionId);
  return row?.id ?? null;
}

export function updateNoteContent(
  db: Db,
  user: User,
  noteId: string,
  content: string,
  expectedVersion?: number,
): NoteView {
  const { row } = loadWritable(db, user, noteId);
  assertEditable(row.status);

  if (expectedVersion !== undefined && expectedVersion !== row.version) {
    throw new HttpError(
      409,
      "version_conflict",
      "This note changed since you opened it. Reload before saving.",
    );
  }

  const at = new Date().toISOString();

  inTransaction(db, () => {
    execute(
      db,
      `UPDATE notes SET content = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
      content,
      at,
      noteId,
    );
    appendEvent(db, {
      noteId,
      actorUserId: user.id,
      type: "content_edit",
      fromStatus: null,
      toStatus: null,
      at,
    });
  });

  return getNoteView(db, user, noteId);
}

export function transitionNote(db: Db, user: User, noteId: string, to: NoteStatus): NoteView {
  const { row } = loadWritable(db, user, noteId);
  assertCanTransition(row.status, to);

  const at = new Date().toISOString();

  inTransaction(db, () => {
    execute(
      db,
      `UPDATE notes SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
      to,
      at,
      noteId,
    );
    appendEvent(db, {
      noteId,
      actorUserId: user.id,
      type: "status_change",
      fromStatus: row.status,
      toStatus: to,
      at,
    });
  });

  return getNoteView(db, user, noteId);
}
