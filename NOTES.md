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
2. **No rate limiting anywhere.** `/api/auth/login` will accept unlimited attempts. scrypt makes
   each guess expensive and the response reveals nothing about which emails exist, but a patient
   attacker with a common-password list is unimpeded. Same for the webhook endpoint: valid
   signatures are cheap to check, invalid ones are not throttled.
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
8. **The unmatched queue only links.** There is no dismiss-with-reason action, so an appointment that
   is genuinely junk stays in the queue forever. Nothing removes it except a link.
9. **The unassigned session is a dead end.** `sess_007` has a draft note that nobody can edit: no
   clinician owns it and oversight roles cannot author. There is no UI to assign a clinician, so
   that note cannot progress. This is the honest consequence of the ownership rule, not an accident,
   but the assignment screen is missing.
10. **No pagination or filtering.** The board returns every session in one query. Correct for eight
    seeded rows, unusable at a real practice's volume.
11. **No automated frontend tests.** The 45 tests cover the API and domain rules. Client behaviour,
    including the failed-save and conflict banners, was verified by hand in a browser at desktop and
    mobile widths.
12. **`npm run seed` is destructive by design.** It drops and rebuilds the schema, because
    `CREATE TABLE IF NOT EXISTS` cannot add a column to an existing database and a half-migrated
    database fails at request time instead of at seed time. There is no incremental migration story:
    a real deployment needs versioned migrations before the first real record exists.

## 4. Production plan

**Deployment.** Containerise the API and run it on ECS Fargate in private subnets behind an ALB;
serve the built client from S3 through CloudFront. Replace SQLite with RDS for PostgreSQL
(Multi-AZ), which the repository boundary already isolates: queries are confined to the service
modules. Secrets (session key, webhook secret, database credentials) come from Secrets Manager, and
the app already refuses to start in production without them. Terraform for infrastructure,
migrations gated in the deploy pipeline, images scanned before promotion.

**HIPAA, once the data is real.** Sign a BAA with AWS and use only in-scope services. Encrypt in
transit (TLS 1.2+ end to end, including ALB to task) and at rest (KMS customer-managed keys on RDS,
S3 and backups). No PHI in logs, URLs, or metrics: the app already keeps note content out of logs
and returns generic error bodies, and that needs enforcing in CI, not just convention. Access
control moves to an IdP with SSO, MFA for all staff, short sessions with idle timeout, and
server-side revocation. Audit logging becomes a hard requirement and must cover reads as well as
writes, shipped to an append-only store (CloudTrail plus an application audit stream to S3 Object
Lock) with retention of at least six years. Automated backups with tested restores and a documented
RPO/RTO. Least-privilege IAM per task role, VPC endpoints so traffic avoids the public internet, and
GuardDuty plus Config for monitoring. Operationally: workforce training, an incident response and
breach notification runbook, annual risk assessment, and BAAs with any downstream vendor, starting
with the scheduling system that sends the webhook.
