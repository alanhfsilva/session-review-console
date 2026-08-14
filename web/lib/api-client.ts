import type {
  Appointment,
  NoteEvent,
  NoteStatus,
  Session,
  User,
} from "../../server/src/types";

export type { Appointment, NoteEvent, NoteStatus, Session, User };

export interface UnmatchedAppointment extends Appointment {
  suggestedSessionId: string | null;
}

export interface BoardEntry extends Session {
  hostName: string | null;
  note: { id: string; status: NoteStatus; updatedAt: string } | null;
}

export interface NoteView {
  note: {
    id: string;
    sessionId: string;
    status: NoteStatus;
    content: string;
    updatedAt: string;
    version: number;
  };
  session: Session;
  history: NoteEvent[];
  permissions: { canEdit: boolean; allowedTransitions: NoteStatus[] };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    // Offline, dropped wifi between sessions, API not running.
    throw new ApiError(0, "network_error", "Cannot reach the server. Check your connection.");
  }

  if (res.status === 204) return undefined as T;

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      error?.code ?? "unknown_error",
      error?.message ?? "Something went wrong.",
    );
  }

  return body as T;
}

export const api = {
  me: () => request<{ user: User }>("/auth/me"),
  login: (email: string, password: string) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  sessions: () => request<{ sessions: BoardEntry[] }>("/sessions"),
  note: (id: string) => request<NoteView>(`/notes/${id}`),
  saveNote: (id: string, content: string, expectedVersion: number) =>
    request<NoteView>(`/notes/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content, expectedVersion }),
    }),
  transitionNote: (id: string, to: NoteStatus) =>
    request<NoteView>(`/notes/${id}/transition`, {
      method: "POST",
      body: JSON.stringify({ to }),
    }),
  unmatchedAppointments: () =>
    request<{ appointments: UnmatchedAppointment[] }>("/appointments/unmatched"),
  linkAppointment: (id: string, sessionId: string) =>
    request<{ appointment: Appointment }>(`/appointments/${id}/link`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
};
