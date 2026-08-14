import { resolve } from "node:path";
import { databasePath, openDatabase } from "../server/src/db.js";
import { seedDatabase } from "../server/src/seed.js";

const fixturesDir = resolve(process.cwd(), "fixtures");
const dbPath = databasePath();

const db = openDatabase(dbPath);
const counts = seedDatabase(db, fixturesDir);
db.close();

console.log(
  `Seeded ${dbPath}: ${counts.users} users, ${counts.sessions} sessions, ` +
    `${counts.notes} notes, ${counts.noteEvents} note events.`,
);
