import type { NoteStatus } from "../lib/api-client";

const LABELS: Record<NoteStatus, string> = {
  draft: "Draft",
  ready: "Ready for review",
  finalized: "Finalized",
};

export function StatusBadge({ status }: { status: NoteStatus | null }) {
  if (!status) return <span className="badge badge-none">No note</span>;
  return <span className={`badge badge-${status}`}>{LABELS[status]}</span>;
}
