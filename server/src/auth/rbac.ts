import type { Session, User, UserRole } from "../types.js";

/** Supervisors and admins have practice-wide read access. */
export function isElevated(user: User): boolean {
  return user.role === "supervisor" || user.role === "admin";
}

export function hasRole(user: User, ...roles: UserRole[]): boolean {
  return roles.includes(user.role);
}

/**
 * Read access to a session and its note. Clinicians see only sessions they
 * hosted; a session with no host is oversight-only, never clinician-visible.
 */
export function canViewSession(user: User, session: Session): boolean {
  if (isElevated(user)) return true;
  if (session.hostEmail === null) return false;
  return session.hostEmail === user.email;
}

/**
 * Write access to a note. Only the clinician of record edits content or moves
 * a note through the workflow; oversight roles read but never author, so the
 * clinical record keeps a single accountable signer.
 */
export function canEditNote(user: User, session: Session): boolean {
  if (user.role !== "clinician") return false;
  if (session.hostEmail === null) return false;
  return session.hostEmail === user.email;
}

/** Reconciling scheduling data is an operational task, not a clinical one. */
export function canResolveAppointments(user: User): boolean {
  return isElevated(user);
}
