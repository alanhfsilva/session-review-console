# Lakeside Session Review Console

A local review console for a therapy practice: clinicians find their sessions, review and finalize
the drafted progress notes, supervisors and administrators oversee the whole board, and a scheduling
vendor pushes appointment events over a signed webhook.

All data is fictional, but the application is built as though the notes were real patient records.

## Requirements

Node.js 22.5 or newer. Storage is SQLite through Node's built-in `node:sqlite` driver, so there is
no native build step and nothing to install beyond npm packages.

## Run it

```bash
npm run setup
```

That installs dependencies, seeds the database from `fixtures/`, and starts both processes. Open
<http://localhost:3000>. The API runs on port 4001 and is bound to loopback only.

Equivalent, if you prefer the steps apart:

```bash
npm install && npm run seed && npm run dev
```

`npm run seed` is destructive: it rebuilds the schema and reloads `fixtures/`, discarding anything
you changed in the app.

## Test it

```bash
npm test
```

## Seeded credentials

Every seeded user shares the demo password **`lakeside-demo`**. It is stored salted and hashed
(scrypt); no plaintext password is written to the database. These are demo credentials for local use
only.

| Email | Name | Role | Sees |
|-------|------|------|------|
| `jordan.lee@lakeside.example` | Jordan Lee | clinician | Own sessions and notes |
| `sam.rivera@lakeside.example` | Sam Rivera | clinician | Own sessions and notes |
| `avery.kim@lakeside.example` | Avery Kim | supervisor | Whole practice, unmatched appointments |
| `riley.chen@lakeside.example` | Riley Chen | admin | Whole practice, unmatched appointments |

Sign in as Jordan to edit and finalize notes; as Avery or Riley to see the practice-wide board and
resolve scheduling gaps.

## Appointment webhook

`POST /api/webhooks/appointments`

### Authenticity

Every delivery carries an HMAC-SHA256 signature over the exact bytes of the request body:

```
X-Lakeside-Signature: t=<unix millis>,v1=<hex digest>
```

The digest is `HMAC_SHA256(secret, "<t>.<raw body>")`. The timestamp is inside the signed material,
and deliveries more than five minutes old are refused, so a captured request cannot be replayed. The
demo secret is `lakeside-webhook-dev`; override it with the `WEBHOOK_SECRET` environment variable.
Anything unsigned, wrongly signed, tampered with, or stale gets a `401` and writes nothing.

### Payload

```json
{
  "eventId": "evt_demo_001",
  "type": "appointment.created",
  "occurredAt": "2026-08-09T09:00:00.000Z",
  "appointment": {
    "id": "appt_seed_001",
    "status": "scheduled",
    "clinicianEmail": "jordan.lee@lakeside.example",
    "scheduledAt": "2026-08-10T14:00:00.000Z",
    "durationMinutes": 50,
    "patientInitials": "M.T.",
    "serviceType": "Individual therapy"
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `eventId` | string | Idempotency key. A redelivery is acknowledged without repeating side effects. |
| `type` | `appointment.created` \| `appointment.updated` \| `appointment.cancelled` | Anything else is rejected. Must agree with `appointment.status`: a cancellation carries `cancelled`, a create or update does not. |
| `occurredAt` | string | ISO 8601, vendor clock. Used to order deliveries. |
| `appointment.id` | string | Vendor appointment id, matched against a session's `externalApptId`. |
| `appointment.status` | `scheduled` \| `rescheduled` \| `cancelled` | |
| `appointment.clinicianEmail` | string \| null | Optional. |
| `appointment.scheduledAt` | string \| null | Optional, ISO 8601. |
| `appointment.durationMinutes` | number \| null | Optional. |
| `appointment.patientInitials` | string \| null | Optional. |
| `appointment.serviceType` | string \| null | Optional. |

Responses are `200 {"received": true, "eventId": "...", "result": "..."}`, where `result` is:

| Result | Meaning |
|--------|---------|
| `linked` | Applied, and the appointment is attached to the session carrying its id. |
| `unmatched` | Applied, but no session claims this appointment id. It waits in the operator queue. |
| `duplicate` | This `eventId` was processed before. Nothing changed. |
| `ignored` | Accepted, but the delivery is older than the state already held, so no field was changed. Late deliveries cannot resurrect a cancelled appointment. |

A webhook never writes clinical note content and never changes a note's status.

### Demo

With the app running:

```bash
npm run webhook:demo
```

It posts a delivery that links to a seeded session, the same delivery retried, one for an
appointment no session claims, a reschedule, a cancellation, and one forged signature. Each line
prints the result against what was expected. Then sign in as `avery.kim@lakeside.example` and open
**Unmatched appointments** to attach the orphan to a session.

The sample event ids are fixed, so a second run without `npm run seed` in between reports every
delivery as a duplicate: that is the idempotency ledger doing its job, not a failure.

## Fixtures

`fixtures/users.json`, `fixtures/sessions.json`, `fixtures/notes.json` hold the seed data with the
contractual field names and types. The seed validates them on load and refuses to run if a note
points at an unknown session or a session is hosted by somebody who is not a clinician.

## Layout

```
fixtures/     seed data
scripts/      seed and webhook demo
server/src/   express api, domain services, sqlite access
tests/        api and domain tests
web/          next.js client (app router)
screenshots/  board and note view, desktop and mobile
```

Architecture decisions, assumptions, known gaps, and the production plan are in
[NOTES.md](NOTES.md).
