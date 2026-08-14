import { queryOne, type Db } from "../db.js";
import type { User, UserRole } from "../types.js";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  password_hash: string;
}

function toUser(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export function findUserById(db: Db, id: string): User | null {
  const row = queryOne<UserRow>(db, `SELECT * FROM users WHERE id = ?`, id);
  return row ? toUser(row) : null;
}

/** Returns the row including the hash; only the login handler should use this. */
export function findUserCredentialsByEmail(
  db: Db,
  email: string,
): { user: User; passwordHash: string } | null {
  const row = queryOne<UserRow>(db, `SELECT * FROM users WHERE email = ?`, email);
  return row ? { user: toUser(row), passwordHash: row.password_hash } : null;
}
