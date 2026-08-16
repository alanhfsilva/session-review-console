"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError, type NoteStatus, type NoteView } from "../lib/api-client";
import { StatusBadge } from "./StatusBadge";
import { NoteHistory } from "./NoteHistory";
import { formatDateTime, formatDuration } from "../lib/format";

const TRANSITION_LABELS: Record<NoteStatus, string> = {
  draft: "Return to draft",
  ready: "Mark ready for review",
  finalized: "Finalize note",
};

export function NoteEditor({ noteId }: { noteId: string }) {
  const [view, setView] = useState<NoteView | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.note(noteId);
      setView(res);
      setDraft(res.note.content);
      // The reload answered the conflict, so the warning about it must go too:
      // a stale banner offering "Retry save" invites the clinician to fight a
      // problem that is already resolved.
      setConflict(false);
      setSaveError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? "This note does not exist, or it belongs to another clinician."
          : err instanceof ApiError
            ? err.message
            : "Could not load this note.",
      );
    }
  }, [noteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = view !== null && draft !== view.note.content;

  async function save() {
    if (!view) return;
    setBusy(true);
    setSaveError(null);
    setConflict(false);
    try {
      const res = await api.saveNote(view.note.id, draft, view.note.version);
      setView(res);
      setDraft(res.note.content);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      // The edit stays in the textarea: a failed save must never look like a
      // successful one, and the clinician must not lose their wording.
      if (err instanceof ApiError && err.code === "version_conflict") {
        setConflict(true);
        setSaveError(err.message);
      } else {
        setSaveError(err instanceof ApiError ? err.message : "Save failed. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function transition(to: NoteStatus) {
    if (!view) return;
    if (to === "finalized") {
      const ok = window.confirm(
        "Finalizing makes this note the clinical record. It cannot be edited afterwards. Continue?",
      );
      if (!ok) return;
    }

    setBusy(true);
    setSaveError(null);
    try {
      const res = await api.transitionNote(view.note.id, to);
      setView(res);
      setDraft(res.note.content);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not update the note status.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="card">
        <p className="banner banner-error" role="alert">
          {loadError}
        </p>
        <Link className="button-link" href="/">
          Back to the board
        </Link>
      </section>
    );
  }

  if (!view) {
    return <p className="muted">Loading note...</p>;
  }

  const { note, session, permissions, history } = view;

  return (
    <section className="note-layout">
      <div>
        <Link className="back-link" href="/">
          Back to the board
        </Link>

        <header className="section-head">
          <h1>
            {session.patientInitials} - {session.serviceType}
          </h1>
          <p className="muted">
            {formatDateTime(session.scheduledAt)} - {formatDuration(session.durationMinutes)}
          </p>
          <StatusBadge status={note.status} />
        </header>

        <div className="card">
          {saveError && (
            <p className="banner banner-error" role="alert">
              {saveError}
              {conflict ? (
                <button className="inline-button" type="button" onClick={() => void load()}>
                  Reload the saved version
                </button>
              ) : (
                <button className="inline-button" type="button" onClick={() => void save()}>
                  Retry save
                </button>
              )}
            </p>
          )}

          {note.status === "finalized" && (
            <p className="banner banner-locked">
              Finalized on {formatDateTime(note.updatedAt)}. This note is the clinical record and is
              no longer editable.
            </p>
          )}

          {note.status !== "finalized" && !permissions.canEdit && (
            <p className="banner banner-locked">
              Read only: your role oversees this note but does not author it.
            </p>
          )}

          <label htmlFor="note-content">Progress note</label>
          <textarea
            id="note-content"
            value={draft}
            rows={14}
            readOnly={!permissions.canEdit}
            onChange={(e) => setDraft(e.target.value)}
          />

          <div className="actions">
            {permissions.canEdit && (
              <button type="button" onClick={() => void save()} disabled={busy || !dirty}>
                {busy ? "Saving..." : dirty ? "Save changes" : "Saved"}
              </button>
            )}

            {permissions.allowedTransitions.map((to) => (
              <button
                key={to}
                type="button"
                className={to === "finalized" ? "primary" : ""}
                onClick={() => void transition(to)}
                disabled={busy || dirty}
                title={dirty ? "Save your changes first" : undefined}
              >
                {TRANSITION_LABELS[to]}
              </button>
            ))}
          </div>

          <p className="muted">
            {dirty
              ? "Unsaved changes"
              : savedAt
                ? `Saved at ${formatDateTime(savedAt)}`
                : `Last updated ${formatDateTime(note.updatedAt)}`}
          </p>
        </div>
      </div>

      <NoteHistory history={history} />
    </section>
  );
}
