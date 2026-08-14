import { resolve } from "node:path";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../server/src/app.js";
import { openDatabase, type Db } from "../server/src/db.js";
import { seedDatabase } from "../server/src/seed.js";
import { DEMO_PASSWORD } from "../server/src/auth/passwords.js";

export const FIXTURES_DIR = resolve(process.cwd(), "fixtures");

export const USERS = {
  jordan: "jordan.lee@lakeside.example",
  sam: "sam.rivera@lakeside.example",
  supervisor: "avery.kim@lakeside.example",
  admin: "riley.chen@lakeside.example",
} as const;

export interface TestContext {
  app: Express;
  db: Db;
}

/** Fresh in-memory database seeded from the real fixtures, per test file. */
export function createTestContext(): TestContext {
  const db = openDatabase(":memory:");
  seedDatabase(db, FIXTURES_DIR);
  return { app: createApp(db), db };
}

/** Logged-in supertest agent that keeps the session cookie across requests. */
export async function loginAs(app: Express, email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password: DEMO_PASSWORD });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status}`);
  }
  return agent;
}
