import { beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import { createTestContext, loginAs, USERS, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

describe("authentication", () => {
  test("rejects a wrong password without issuing a session cookie", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: USERS.jordan, password: "not-the-password" });

    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  test("does not reveal whether an email exists", async () => {
    const unknown = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: "nobody@lakeside.example", password: "lakeside-demo" });
    const wrongPassword = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: USERS.jordan, password: "wrong" });

    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrongPassword.body);
  });

  test("rejects unauthenticated session listing", async () => {
    const res = await request(ctx.app).get("/api/sessions");
    expect(res.status).toBe(401);
  });

  test("never returns the password hash to the client", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.get("/api/auth/me");

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("scrypt$");
  });
});

describe("clinician scoping", () => {
  test("lists only sessions the clinician hosted", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.get("/api/sessions");

    expect(res.status).toBe(200);
    const hosts: unknown[] = res.body.sessions.map((s: { hostEmail: string }) => s.hostEmail);
    expect(hosts.length).toBeGreaterThan(0);
    expect(new Set(hosts)).toEqual(new Set([USERS.jordan]));
  });

  test("cannot read another clinician's session by id", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.get("/api/sessions/sess_004"); // hosted by Sam Rivera

    expect(res.status).toBe(404);
  });

  test("cannot read an unassigned session by id", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.get("/api/sessions/sess_007"); // hostEmail is null

    expect(res.status).toBe(404);
  });

  test("a client-supplied role in the request body is ignored", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.get("/api/sessions").send({ role: "admin" });

    const hosts: unknown[] = res.body.sessions.map((s: { hostEmail: string }) => s.hostEmail);
    expect(new Set(hosts)).toEqual(new Set([USERS.jordan]));
  });
});

describe("practice-wide oversight", () => {
  test("supervisor sees sessions across clinicians, including unassigned", async () => {
    const agent = await loginAs(ctx.app, USERS.supervisor);
    const res = await agent.get("/api/sessions");

    expect(res.status).toBe(200);
    const ids: string[] = res.body.sessions.map((s: { id: string }) => s.id);
    expect(ids).toContain("sess_001");
    expect(ids).toContain("sess_004");
    expect(ids).toContain("sess_007");
  });

  test("admin can read any session by id", async () => {
    const agent = await loginAs(ctx.app, USERS.admin);
    const res = await agent.get("/api/sessions/sess_004");

    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe("sess_004");
  });
});
