export type UserRole = "clinician" | "supervisor" | "admin";

export type NoteStatus = "draft" | "ready" | "finalized";

export type NoteEventType = "seeded" | "content_edit" | "status_change";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface Session {
  id: string;
  hostEmail: string | null;
  scheduledAt: string;
  durationMinutes: number;
  patientInitials: string;
  serviceType: string;
  externalApptId: string | null;
}

export interface Note {
  id: string;
  sessionId: string;
  status: NoteStatus;
  content: string;
  updatedAt: string;
}

export interface NoteEvent {
  id: string;
  noteId: string;
  actorUserId: string;
  actorName: string | null;
  type: NoteEventType;
  fromStatus: NoteStatus | null;
  toStatus: NoteStatus | null;
  at: string;
}

export type AppointmentStatus = "scheduled" | "rescheduled" | "cancelled";

export interface Appointment {
  id: string;
  status: AppointmentStatus;
  clinicianEmail: string | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  patientInitials: string | null;
  serviceType: string | null;
  sessionId: string | null;
  unmatched: boolean;
  updatedAt: string;
}

/** Thrown by domain code; the error middleware maps `status` onto the response. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}
