import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { inTransaction, resetSchema, type Db } from "./db.js";
import { DEMO_PASSWORD, hashPassword } from "./auth/passwords.js";

/**
 * Fixture shapes are contractual: field names and types come from the brief and
 * are validated here so a malformed fixture fails the seed instead of the app.
 */
const userSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["clinician", "supervisor", "admin"]),
});

const sessionSchema = z.object({
  id: z.string().min(1),
  hostEmail: z.string().email().nullable(),
  scheduledAt: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  patientInitials: z.string().min(1),
  serviceType: z.string().min(1),
  externalApptId: z.string().min(1).nullable(),
});

const noteSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(["draft", "ready", "finalized"]),
  content: z.string(),
  updatedAt: z.string().min(1),
});

export interface SeedCounts {
  users: number;
  sessions: number;
  notes: number;
  noteEvents: number;
}

function readFixture<T>(dir: string, file: string, schema: z.ZodType<T>): T[] {
  const raw: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const parsed = z.array(schema).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${file} does not match the fixture contract: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function seedDatabase(db: Db, fixturesDir: string): SeedCounts {
  const users = readFixture(fixturesDir, "users.json", userSchema);
  const sessions = readFixture(fixturesDir, "sessions.json", sessionSchema);
  const notes = readFixture(fixturesDir, "notes.json", noteSchema);

  const sessionIds = new Set(sessions.map((s) => s.id));
  for (const note of notes) {
    if (!sessionIds.has(note.sessionId)) {
      throw new Error(`notes.json: ${note.id} references unknown session ${note.sessionId}`);
    }
  }

  const clinicianEmails = new Set(
    users.filter((u) => u.role === "clinician").map((u) => u.email),
  );
  for (const session of sessions) {
    if (session.hostEmail !== null && !clinicianEmails.has(session.hostEmail)) {
      throw new Error(`sessions.json: ${session.id} host ${session.hostEmail} is not a clinician`);
    }
  }

  // Seeding is destructive by contract: it rebuilds the schema so a database
  // created by an earlier version of the app cannot survive with a stale shape.
  resetSchema(db);

  inTransaction(db, () => {
    const insertUser = db.prepare(
      `INSERT INTO users (id, name, email, role, password_hash) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const user of users) {
      insertUser.run(user.id, user.name, user.email, user.role, hashPassword(DEMO_PASSWORD));
    }

    const insertSession = db.prepare(
      `INSERT INTO sessions
         (id, host_email, scheduled_at, duration_minutes, patient_initials, service_type, external_appt_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of sessions) {
      insertSession.run(
        s.id,
        s.hostEmail,
        s.scheduledAt,
        s.durationMinutes,
        s.patientInitials,
        s.serviceType,
        s.externalApptId,
      );
    }

    const insertNote = db.prepare(
      `INSERT INTO notes (id, session_id, status, content, updated_at) VALUES (?, ?, ?, ?, ?)`,
    );
    const insertEvent = db.prepare(
      `INSERT INTO note_events (id, note_id, actor_user_id, type, from_status, to_status, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const n of notes) {
      insertNote.run(n.id, n.sessionId, n.status, n.content, n.updatedAt);
      // History before import is not reconstructed; the baseline is recorded as
      // one seeded event so every note has a traceable starting point.
      insertEvent.run(randomUUID(), n.id, "system_seed", "seeded", null, n.status, n.updatedAt);
    }
  });

  return {
    users: users.length,
    sessions: sessions.length,
    notes: notes.length,
    noteEvents: notes.length,
  };
}
