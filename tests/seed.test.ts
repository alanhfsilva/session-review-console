import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDatabase, queryAll, queryOne } from "../server/src/db.js";
import { seedDatabase } from "../server/src/seed.js";
import { FIXTURES_DIR } from "./helpers.js";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lakeside-seed-"));
  dbPath = join(dir, "test.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("seeding", () => {
  test("covers every role and every note status", () => {
    const db = openDatabase(dbPath);
    const counts = seedDatabase(db, FIXTURES_DIR);

    const roles = queryAll<{ role: string }>(db, `SELECT DISTINCT role FROM users`).map(
      (r) => r.role,
    );
    const statuses = queryAll<{ status: string }>(db, `SELECT DISTINCT status FROM notes`).map(
      (r) => r.status,
    );

    expect(new Set(roles)).toEqual(new Set(["clinician", "supervisor", "admin"]));
    expect(new Set(statuses)).toEqual(new Set(["draft", "ready", "finalized"]));
    expect(counts.users).toBeGreaterThanOrEqual(4);
    db.close();
  });

  test("gives every note a starting point in its history", () => {
    const db = openDatabase(dbPath);
    seedDatabase(db, FIXTURES_DIR);

    const orphaned = queryOne<{ count: number }>(
      db,
      `SELECT COUNT(*) AS count FROM notes n
        WHERE NOT EXISTS (SELECT 1 FROM note_events e WHERE e.note_id = n.id)`,
    );

    expect(orphaned?.count).toBe(0);
    db.close();
  });

  test("stores no plaintext passwords", () => {
    const db = openDatabase(dbPath);
    seedDatabase(db, FIXTURES_DIR);

    const hashes = queryAll<{ password_hash: string }>(db, `SELECT password_hash FROM users`);
    expect(hashes.length).toBeGreaterThan(0);
    for (const row of hashes) {
      expect(row.password_hash).not.toContain("lakeside-demo");
      expect(row.password_hash.startsWith("scrypt$")).toBe(true);
    }
    db.close();
  });

  test("repairs a database left behind by an older schema", () => {
    // A notes table from before optimistic locking existed.
    const stale = new DatabaseSync(dbPath);
    stale.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        status TEXT,
        content TEXT,
        updated_at TEXT
      );
    `);
    stale.close();

    const db = openDatabase(dbPath);
    seedDatabase(db, FIXTURES_DIR);

    const note = queryOne<{ version: number }>(db, `SELECT version FROM notes LIMIT 1`);
    expect(note?.version).toBe(1);
    db.close();
  });
});
