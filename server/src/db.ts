import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Storage is SQLite through Node's built-in `node:sqlite` driver: no native
 * build step, so `npm install` cannot fail on a compiler toolchain. Requires
 * Node 22.5 or newer.
 */
export type Db = DatabaseSync;

export type SqlValue = string | number | bigint | null | Uint8Array;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('clinician','supervisor','admin')),
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT PRIMARY KEY,
  host_email       TEXT,
  scheduled_at     TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  patient_initials TEXT NOT NULL,
  service_type     TEXT NOT NULL,
  external_appt_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_host ON sessions (host_email);
CREATE INDEX IF NOT EXISTS idx_sessions_appt ON sessions (external_appt_id);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  status     TEXT NOT NULL CHECK (status IN ('draft','ready','finalized')),
  content    TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Bumped on every write so a stale client save is rejected, not merged blindly.
  version    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_notes_session ON notes (session_id);

-- Append-only clinical trail. Rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS note_events (
  id            TEXT PRIMARY KEY,
  note_id       TEXT NOT NULL REFERENCES notes (id),
  actor_user_id TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('seeded','content_edit','status_change')),
  from_status   TEXT,
  to_status     TEXT,
  at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_events_note ON note_events (note_id, at);

CREATE TABLE IF NOT EXISTS appointments (
  id               TEXT PRIMARY KEY,
  status           TEXT NOT NULL,
  clinician_email  TEXT,
  scheduled_at     TEXT,
  duration_minutes INTEGER,
  patient_initials TEXT,
  service_type     TEXT,
  session_id       TEXT REFERENCES sessions (id),
  unmatched        INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_unmatched ON appointments (unmatched);

-- Who changed an appointment and why: vendor deliveries and operator actions.
CREATE TABLE IF NOT EXISTS appointment_events (
  id             TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL,
  actor_user_id  TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('received','linked','unmatched')),
  detail         TEXT,
  at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointment_events_appt ON appointment_events (appointment_id, at);

-- Idempotency ledger: a delivered event id is processed at most once.
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id       TEXT PRIMARY KEY,
  type           TEXT NOT NULL,
  appointment_id TEXT,
  received_at    TEXT NOT NULL
);
`;

export function migrate(db: Db): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
}

/**
 * Rebuilds the schema from scratch. `CREATE TABLE IF NOT EXISTS` cannot add a
 * column to a database that already exists, so seeding drops first: without
 * this, an older database file silently keeps an outdated shape and fails at
 * request time rather than at seed time.
 */
export function resetSchema(db: Db): void {
  db.exec(`
    DROP TABLE IF EXISTS webhook_events;
    DROP TABLE IF EXISTS appointment_events;
    DROP TABLE IF EXISTS appointments;
    DROP TABLE IF EXISTS note_events;
    DROP TABLE IF EXISTS notes;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;
  `);
  migrate(db);
}

export function openDatabase(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  migrate(db);
  return db;
}

/**
 * The driver returns untyped rows. These helpers keep the cast in one place so
 * call sites work with declared row shapes instead of scattering assertions.
 */
export function queryAll<Row>(db: Db, sql: string, ...params: SqlValue[]): Row[] {
  return db.prepare(sql).all(...params) as unknown as Row[];
}

export function queryOne<Row>(db: Db, sql: string, ...params: SqlValue[]): Row | undefined {
  return db.prepare(sql).get(...params) as unknown as Row | undefined;
}

export function execute(db: Db, sql: string, ...params: SqlValue[]): void {
  db.prepare(sql).run(...params);
}

/** Runs `fn` in a transaction, rolling back if it throws. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function databasePath(): string {
  return process.env.DB_PATH ?? resolve(process.cwd(), "data/lakeside.sqlite");
}

let singleton: Db | undefined;

/** Process-wide handle used by the API. Tests point DB_PATH at a temp file. */
export function getDb(): Db {
  singleton ??= openDatabase(databasePath());
  return singleton;
}
