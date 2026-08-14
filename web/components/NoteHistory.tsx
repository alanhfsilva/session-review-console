import type { NoteEvent } from "../lib/api-client";
import { formatDateTime } from "../lib/format";

function describe(event: NoteEvent): string {
  switch (event.type) {
    case "seeded":
      return `Imported from records as ${event.toStatus}`;
    case "content_edit":
      return "Edited note content";
    case "status_change":
      return `Moved ${event.fromStatus} to ${event.toStatus}`;
    default:
      return "Recorded change";
  }
}

export function NoteHistory({ history }: { history: NoteEvent[] }) {
  return (
    <section className="card" aria-labelledby="history-heading">
      <h2 id="history-heading">How this note reached its current state</h2>
      <ol className="history">
        {history.map((event) => (
          <li key={event.id}>
            <span className={`history-dot history-${event.type}`} aria-hidden="true" />
            <div>
              <p className="history-action">{describe(event)}</p>
              <p className="muted">
                {event.actorName ?? event.actorUserId} - {formatDateTime(event.at)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
