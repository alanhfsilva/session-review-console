import { HttpError, type NoteStatus } from "../types.js";

export const NOTE_STATUSES: readonly NoteStatus[] = ["draft", "ready", "finalized"];

/**
 * The clinical workflow is strictly forward. `finalized` is terminal: the note
 * is the record the practice stands behind, so there is no edit or reopen path
 * without an explicit, audited amendment feature (not built - see NOTES).
 */
const ALLOWED: Record<NoteStatus, readonly NoteStatus[]> = {
  draft: ["ready"],
  ready: ["finalized"],
  finalized: [],
};

export function allowedTransitions(from: NoteStatus): readonly NoteStatus[] {
  return ALLOWED[from];
}

export function isNoteStatus(value: unknown): value is NoteStatus {
  return typeof value === "string" && NOTE_STATUSES.includes(value as NoteStatus);
}

export function assertCanTransition(from: NoteStatus, to: NoteStatus): void {
  if (!ALLOWED[from].includes(to)) {
    throw new HttpError(
      409,
      "illegal_transition",
      `A note cannot move from ${from} to ${to}.`,
    );
  }
}

export function assertEditable(status: NoteStatus): void {
  if (status === "finalized") {
    throw new HttpError(
      409,
      "note_finalized",
      "This note is finalized and can no longer be edited.",
    );
  }
}
