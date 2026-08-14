import { beforeEach, describe, expect, test } from "vitest";
import { createTestContext, loginAs, USERS, type TestContext } from "./helpers.js";

// note_003 is a draft on sess_003, hosted by Jordan Lee.
// note_002 is ready on sess_002, hosted by Jordan Lee.
// note_001 is finalized on sess_001, hosted by Jordan Lee.
// note_004 is finalized on sess_004, hosted by Sam Rivera.

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

function statusOf(noteId: string): string {
  const row = ctx.db.prepare(`SELECT status FROM notes WHERE id = ?`).get(noteId) as {
    status: string;
  };
  return row.status;
}

function contentOf(noteId: string): string {
  const row = ctx.db.prepare(`SELECT content FROM notes WHERE id = ?`).get(noteId) as {
    content: string;
  };
  return row.content;
}

describe("illegal transitions", () => {
  test("rejects draft straight to finalized and leaves the note in draft", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.post("/api/notes/note_003/transition").send({ to: "finalized" });

    expect(res.status).toBe(409);
    expect(statusOf("note_003")).toBe("draft");
  });

  test("rejects moving a finalized note back to ready", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.post("/api/notes/note_001/transition").send({ to: "ready" });

    expect(res.status).toBe(409);
    expect(statusOf("note_001")).toBe("finalized");
  });

  test("rejects an unknown target status", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.post("/api/notes/note_003/transition").send({ to: "archived" });

    expect(res.status).toBe(400);
    expect(statusOf("note_003")).toBe("draft");
  });
});

describe("finalized notes are the record of practice", () => {
  test("rejects content edits after finalize and leaves content untouched", async () => {
    const before = contentOf("note_001");
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent
      .patch("/api/notes/note_001")
      .send({ content: "rewritten after sign", expectedVersion: 1 });

    expect(res.status).toBe(409);
    expect(contentOf("note_001")).toBe(before);
  });
});

describe("ownership", () => {
  test("a clinician cannot read another clinician's note", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.get("/api/notes/note_004");

    expect(res.status).toBe(404);
  });

  test("a clinician cannot edit another clinician's note", async () => {
    const before = contentOf("note_005");
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent
      .patch("/api/notes/note_005")
      .send({ content: "not mine", expectedVersion: 1 });

    expect(res.status).toBe(404);
    expect(contentOf("note_005")).toBe(before);
  });

  test("a clinician cannot transition another clinician's note", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.post("/api/notes/note_006/transition").send({ to: "finalized" });

    expect(res.status).toBe(404);
    expect(statusOf("note_006")).toBe("ready");
  });

  test("a supervisor reads any note but cannot author clinical content", async () => {
    const agent = await loginAs(ctx.app, USERS.supervisor);

    const read = await agent.get("/api/notes/note_003");
    expect(read.status).toBe(200);
    expect(read.body.permissions.canEdit).toBe(false);

    const write = await agent
      .patch("/api/notes/note_003")
      .send({ content: "supervisor edit", expectedVersion: 1 });
    expect(write.status).toBe(403);
    expect(contentOf("note_003")).not.toBe("supervisor edit");
  });

  test("a supervisor cannot finalize a clinician's note", async () => {
    const agent = await loginAs(ctx.app, USERS.supervisor);
    const res = await agent.post("/api/notes/note_002/transition").send({ to: "finalized" });

    expect(res.status).toBe(403);
    expect(statusOf("note_002")).toBe("ready");
  });
});

describe("concurrent edits", () => {
  test("refuses a save that does not say which version it edited", async () => {
    const before = contentOf("note_003");
    const agent = await loginAs(ctx.app, USERS.jordan);
    const res = await agent.patch("/api/notes/note_003").send({ content: "blind overwrite" });

    expect(res.status).toBe(400);
    expect(contentOf("note_003")).toBe(before);
  });

  test("a save based on a stale version is rejected instead of overwriting", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const loaded = await agent.get("/api/notes/note_003");
    const staleVersion: number = loaded.body.note.version;

    const first = await agent
      .patch("/api/notes/note_003")
      .send({ content: "first device wins", expectedVersion: staleVersion });
    expect(first.status).toBe(200);

    const second = await agent
      .patch("/api/notes/note_003")
      .send({ content: "second device clobbers", expectedVersion: staleVersion });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("version_conflict");
    expect(contentOf("note_003")).toBe("first device wins");
  });
});

describe("traceability", () => {
  test("records who edited content and when", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    const before = (await agent.get("/api/notes/note_003")).body.note.updatedAt;

    const saved = await agent
      .patch("/api/notes/note_003")
      .send({ content: "reviewed and expanded", expectedVersion: 1 });
    expect(saved.status).toBe(200);
    expect(saved.body.note.updatedAt).not.toBe(before);

    const history = (await agent.get("/api/notes/note_003")).body.history;
    const edit = history.find((e: { type: string }) => e.type === "content_edit");
    expect(edit).toBeDefined();
    expect(edit.actorUserId).toBe("user_clin_1");
    expect(edit.actorName).toBe("Jordan Lee");
  });

  test("records the from and to status of every transition", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);

    expect((await agent.post("/api/notes/note_003/transition").send({ to: "ready" })).status).toBe(200);
    expect((await agent.post("/api/notes/note_003/transition").send({ to: "finalized" })).status).toBe(200);

    const history = (await agent.get("/api/notes/note_003")).body.history;
    const changes = history
      .filter((e: { type: string }) => e.type === "status_change")
      .map((e: { fromStatus: string; toStatus: string }) => `${e.fromStatus}->${e.toStatus}`);

    expect(changes).toEqual(["draft->ready", "ready->finalized"]);
    expect(history[0].type).toBe("seeded");
  });

  test("history survives finalize and stays append-only", async () => {
    const agent = await loginAs(ctx.app, USERS.jordan);
    await agent.patch("/api/notes/note_002").send({ content: "final wording", expectedVersion: 1 });
    await agent.post("/api/notes/note_002/transition").send({ to: "finalized" });

    const history = (await agent.get("/api/notes/note_002")).body.history;
    expect(history.length).toBe(3); // seeded, content_edit, status_change
    expect(history.at(-1).toStatus).toBe("finalized");
  });
});
