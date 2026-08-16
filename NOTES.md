# Notes

## 1. Architecture decisions

**Shape.** One npm package with two processes: a Next.js client on 3000 and an Express API on 4001,
reached through a Next rewrite so the browser sees a single origin and the session cookie stays
first-party. One repository, one install, one command to run.

**Next.js for the client, Express for the API.** Keeping the API as its own service draws a hard
line around the code that enforces access: authorization, the note state machine and webhook
verification live in one place, testable over HTTP without a framework harness, and reachable by the
scheduling vendor without routing vendor traffic through the rendering layer. Every route that
touches patient data is `force-dynamic`, and the app sends `no-store` for all responses, because a
cached note served to the wrong clinician is exactly the failure the access rules exist to prevent.

**Storage: SQLite via Node's built-in `node:sqlite`.** I started on `better-sqlite3` and dropped it:
its native binding segfaulted on this machine, from both the shipped prebuild and a source rebuild.
The built-in driver has the same synchronous API shape, needs no compiler at install time, and
removes a whole class of "it does not build on my machine" failure for whoever runs this. The cost
is a Node 22.5 floor, declared in `engines`. Data lives in `data/lakeside.sqlite`, which is
gitignored: seed data is reproducible from `fixtures/`, so the database is a build artifact.

**Authorization is a pure module.** `server/src/auth/rbac.ts` holds `canViewSession`, `canEditNote`,
`canResolveAppointments` as plain functions over a user and a session, and the note state machine in
`server/src/notes/transitions.ts` is a table plus two assertions. Both are exercised through the API
in tests, but keeping them free of Express and SQL means the clinical rules can be read in one sitting.

**The role filter lives in SQL.** A clinician's list query carries `WHERE s.host_email = ?`. Other
clinicians' rows never leave the database, so a rendering mistake in the client cannot leak them.

**Three write-integrity rules, each enforced in one place.** They exist because the demo-day
failures are not the ones that hurt later.

- *Notes carry a version.* A save states the version it edited, and a mismatch is a `409` naming the
  conflict rather than a silent overwrite. Two clinicians on the same note is ordinary in a practice,
  and the loser of that race must not lose their words: the client keeps the typed text and offers
  the saved version to compare.
- *Deliveries are keyed by `eventId`.* Scheduling vendors retry, so the ledger makes processing
  happen at most once, and the write is one transaction: a delivery that fails partway records
  nothing, leaving the retry free to succeed. Out-of-order deliveries are dropped by comparing the
  vendor's `occurredAt`, so a late create cannot resurrect a cancelled appointment.
- *Status lives in a transition table, not in handlers.* `draft → ready → finalized`, terminal at
  the end, checked server-side before any write. Status is a domain invariant, so the UI hiding a
  button is a courtesy, never the control.

**Auth.** Signed httpOnly cookie (`sameSite=lax`), carrying a user id and issue time, with an
absolute eight-hour lifetime checked server-side. Every request reloads the user from the database,
so a role is never taken from client-controlled data. Passwords are scrypt hashes with per-user
salts even though the brief permits a plain password map: a clinical system should not have a
plaintext credential column, demo or not.

**Client state.** Deliberately plain: React state in client components and a small typed `fetch`
wrapper, with the server response as the single source of truth after every mutation. Data is
fetched from the browser rather than in server components so that every read crosses the same
authenticated API boundary, with one place deciding who may see a note. The client imports its types directly
from the server's domain types, so a field rename breaks the build rather than the page. No data
layer library, because nothing here needs a cache: the board is one request and the note view is one
request.

**Audit.** `note_events` and `appointment_events` are append-only tables. Nothing in the application
updates or deletes a row in either. The note view reads its history straight from `note_events`
rather than reconstructing it from logs.

## 2. Assumptions

The brief was silent on several policies. What I chose, and why:

- **Supervisors and admins read everything but author nothing.** They see every session and note
  across the practice and cannot edit content or move a note through the workflow. A progress note
  is the clinician's clinical statement; oversight that can quietly rewrite it destroys the value of
  the signature. Where an oversight role is refused, the API answers `403` rather than pretending
  the note does not exist.
- **Finalized is terminal.** There is no reopen or amend path. Real practices need addenda, but a
  half-built amendment flow is worse than none, so `finalized` is immutable and the gap is listed
  below.
- **Missing and forbidden look the same to a clinician.** Requesting another clinician's session or
  note returns `404`, not `403`, so ids cannot be probed for existence. This only applies where the
  resource is outside the caller's scope entirely.
- **Sessions with no `hostEmail` are oversight-only.** No clinician can open them; supervisors and
  admins can. A recorded session with no clinician of record is a scheduling defect, and guessing an
  owner would be worse than showing it to the people who fix such things.
- **Appointments match on `externalApptId` only.** No fuzzy matching on clinician plus time. The
  unmatched queue shows a same-clinician, same-start-time suggestion, but a human must confirm it;
  automatically attaching a stranger's appointment to a session is the kind of error that ends up in
  the wrong chart.
- **A cancelled appointment does not touch its session or note.** Cancellation is scheduling data.
  It never deletes rows and never alters clinical content.
- **All seeded users share one password**, documented in the README, since the brief asked for a
  documented credential scheme rather than an identity provider.

## 3. Not done, and what would break

Concrete gaps, roughly in the order I would fix them:

1. **No CSRF token.** State-changing routes rely on `sameSite=lax` plus a JSON content type. That
   holds for current browsers, but a same-site subdomain takeover or a browser that treats Lax
   loosely would allow a forged `POST /api/notes/:id/transition` from a logged-in clinician's
   browser. A per-session token on mutating requests is the fix.
2. **No rate limiting anywhere.** `/api/auth/login` will accept unlimited attempts. Every attempt
   costs a scrypt hash, and unknown emails are hashed against a dummy so neither the response body
   nor its timing separates a real address from a fake one, but a patient attacker with a
   common-password list is unimpeded. Same for the webhook endpoint: valid signatures are cheap to
   check, invalid ones are not throttled.
3. **Sign-out cannot revoke a stolen cookie.** There is no server-side session store, so signing out
   clears the browser's cookie but a copy captured beforehand stays valid until its eight-hour
   absolute expiry. There is also no idle timeout, so an unlocked shared workstation stays signed in
   for the full window.
4. **Read access is not audited.** Writes are recorded with actor and timestamp; reads are not. Under
   real HIPAA obligations, "who opened this chart" matters as much as who changed it, and today that
   question cannot be answered from the database.
5. **History records that content changed, not what changed.** `note_events` stores the actor, the
   time, and the status transition, but no diff or prior text. A clinician can see that someone
   edited a note at 4:12 PM and not what the note said before.
6. **Append-only is a convention, not a constraint.** No triggers or WORM storage stop a process with
   database access from rewriting `note_events`. In production this belongs behind an immutable audit
   sink.
7. **The board does not show appointment or cancellation state.** Webhook data is stored, linked and
   reconcilable, and the unmatched queue works, but a clinician looking at the board cannot see that
   an appointment for a session was cancelled or moved. That information currently only exists in
   the `appointments` table.
8. **The unmatched queue only links, and linking is one way.** There is no dismiss-with-reason
   action, so a genuinely junk appointment sits in the queue forever. Worse, attaching is final:
   the API refuses to move an already-linked appointment, so a supervisor who picks the wrong
   session cannot correct it from the console. That trade buys the guarantee that one vendor
   appointment never claims two sessions, but an unlink action, audited like the link, is the
   missing half.
9. **The unassigned session is a dead end.** `sess_007` has a draft note that nobody can edit: no
   clinician owns it and oversight roles cannot author. There is no UI to assign a clinician, so
   that note cannot progress. This is the honest consequence of the ownership rule, not an accident,
   but the assignment screen is missing.
10. **No pagination or filtering.** The board returns every session in one query. Correct for eight
    seeded rows, unusable at a real practice's volume.
11. **Client test coverage stops at the note editor.** Of the 62 tests, five render the editor and
    cover what happens when a save is refused or the server is unreachable: the typed text survives,
    the error is shown, and success is never implied. Nothing else in the client is tested. The
    board, the login form and the unmatched queue were checked by hand at desktop and mobile widths,
    and a regression in their loading or empty states would not fail the suite.
12. **Event ordering trusts the scheduling vendor's clock.** Deliveries older than the last applied
    event are acknowledged and dropped, which stops a late create from resurrecting a cancellation.
    The cost is that a vendor whose clock jumps backwards, after a restart or a daylight-saving
    slip, would have legitimate updates silently ignored, and nothing in the console shows that it
    happened. Two events sharing a timestamp are applied in arrival order, so a create and a cancel
    issued in the same tick still resolve last-write-wins. A vendor sequence number would settle
    both cases better than a timestamp.
13. **`npm run seed` is destructive by design.** It drops and rebuilds the schema, because
    `CREATE TABLE IF NOT EXISTS` cannot add a column to an existing database and a half-migrated
    database fails at request time instead of at seed time. There is no incremental migration story:
    a real deployment needs versioned migrations before the first real record exists.

## 4. Production plan

**Deployment.** Run the API as a container on AWS (Amazon Web Services) Fargate, which leaves no
servers to patch, on a private network behind a load balancer terminating HTTPS. Serve the client
from S3 storage through CloudFront, Amazon's content delivery network. Swap SQLite for RDS
PostgreSQL, a managed database, with a warm standby. Secrets come from AWS Secrets Manager, and the
app already refuses to start in production without them. Only the database module changes.

**Cost.** Roughly $250 to $350 a month for one practice, about half of it the standby database.
Dropping the standby halves that line but turns a failover into a restore measured in hours: a
deliberate choice, not a default.

**What HIPAA adds.** HIPAA is the American law protecting patient health information, and it turns
several gaps above into obligations. Sign a Business Associate Agreement (BAA) with AWS and with the
scheduling vendor, then use only services they cover. Encrypt in transit and at rest, backups
included. Keep patient data out of logs, URLs and metrics, enforced in the build rather than by
habit. Replace the demo password map with single sign-on and multi-factor authentication, and
sessions the practice can revoke centrally. Record who *read* a chart, not only who changed one, in
storage nobody can rewrite, kept six years. Add tested restores, least-privilege access, an annual
risk assessment, and a breach-notification procedure. Much of this is process rather than code, and
the process is what takes months.
