// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiError, type NoteView } from "../web/lib/api-client";

// next/link needs an app router mounted; the editor only uses it to get back to
// the board, so a plain anchor is an honest stand-in here.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const note = vi.fn();
const saveNote = vi.fn();
const transitionNote = vi.fn();

vi.mock("../web/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../web/lib/api-client")>();
  return {
    ...actual,
    api: {
      note: (...args: unknown[]) => note(...args),
      saveNote: (...args: unknown[]) => saveNote(...args),
      transitionNote: (...args: unknown[]) => transitionNote(...args),
    },
  };
});

const { NoteEditor } = await import("../web/components/NoteEditor");

const DRAFT_VIEW: NoteView = {
  note: {
    id: "note_003",
    sessionId: "sess_003",
    status: "draft",
    content: "Brief medication check-in.",
    updatedAt: "2026-08-12T13:58:00.000Z",
    version: 1,
  },
  session: {
    id: "sess_003",
    hostEmail: "jordan.lee@lakeside.example",
    scheduledAt: "2026-08-12T13:30:00.000Z",
    durationMinutes: 30,
    patientInitials: "D.A.",
    serviceType: "Medication check-in",
    externalApptId: null,
  },
  history: [],
  permissions: { canEdit: true, allowedTransitions: ["ready"] },
};

const TYPED = " Patient tolerating the new dose well.";

async function renderEditorAndType() {
  render(<NoteEditor noteId="note_003" />);
  const textarea = await screen.findByLabelText("Progress note");

  fireEvent.change(textarea, { target: { value: DRAFT_VIEW.note.content + TYPED } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

  return textarea as HTMLTextAreaElement;
}

beforeEach(() => {
  cleanup();
  note.mockReset().mockResolvedValue(DRAFT_VIEW);
  saveNote.mockReset();
  transitionNote.mockReset();
});

describe("a save that fails", () => {
  test("keeps the clinician's words and offers the saved version when someone else edited it", async () => {
    saveNote.mockRejectedValue(
      new ApiError(409, "version_conflict", "This note changed since you opened it."),
    );

    const textarea = await renderEditorAndType();

    await screen.findByText(/this note changed since you opened it/i);
    expect(screen.getByRole("button", { name: /reload the saved version/i })).toBeTruthy();
    // The typed words must survive: losing them is losing clinical work.
    expect(textarea.value).toContain(TYPED.trim());
  });

  test("keeps the clinician's words and offers a retry when the server is unreachable", async () => {
    saveNote.mockRejectedValue(new ApiError(0, "network_error", "Cannot reach the server."));

    const textarea = await renderEditorAndType();

    await screen.findByText(/cannot reach the server/i);
    expect(screen.getByRole("button", { name: /retry save/i })).toBeTruthy();
    expect(textarea.value).toContain(TYPED.trim());
  });

  test("never reports success when the save was refused", async () => {
    saveNote.mockRejectedValue(new ApiError(409, "version_conflict", "Changed elsewhere."));

    await renderEditorAndType();

    await screen.findByText(/changed elsewhere/i);
    expect(screen.queryByText(/^Saved at/)).toBeNull();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });
});

describe("reloading after a conflict", () => {
  test("replaces the editor with what the practice actually holds", async () => {
    saveNote.mockRejectedValue(new ApiError(409, "version_conflict", "Changed elsewhere."));
    const textarea = await renderEditorAndType();
    await screen.findByText(/changed elsewhere/i);

    note.mockResolvedValue({
      ...DRAFT_VIEW,
      note: { ...DRAFT_VIEW.note, content: "Version saved from the clinic desktop.", version: 2 },
    });
    fireEvent.click(screen.getByRole("button", { name: /reload the saved version/i }));

    await waitFor(() => {
      expect(textarea.value).toBe("Version saved from the clinic desktop.");
    });
    expect(screen.queryByText(/changed elsewhere/i)).toBeNull();
  });
});

describe("a finalized note", () => {
  test("cannot be edited and offers no workflow actions", async () => {
    note.mockResolvedValue({
      ...DRAFT_VIEW,
      note: { ...DRAFT_VIEW.note, status: "finalized" },
      permissions: { canEdit: false, allowedTransitions: [] },
    });

    render(<NoteEditor noteId="note_003" />);

    const textarea = (await screen.findByLabelText("Progress note")) as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(screen.getByText(/no longer editable/i)).toBeTruthy();
  });
});
