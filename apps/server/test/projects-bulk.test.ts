/**
 * The Projects selection bar: deleteProjects / retryProjects / rerenderProjects run each project through its own
 * owner-facing service, report per project, and one failure (someone else's project) never stops the rest.
 * Postgres only.  node --import tsx --test test/projects-bulk.test.ts
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { TRPCError } from "@trpc/server";
import { lifecycleHarness } from "./lifecycle-harness.js";
import { deleteProjects, rerenderProjects, retryProjects } from "../src/projects/bulk.js";

const h = lifecycleHarness();
const notReady = await h.ready();
(h.svc.settings.get() as { DELETED_RETENTION_DAYS: number }).DELETED_RETENTION_DAYS = 7;

after(() => h.cleanup());

describe("bulk project actions", { skip: notReady ?? false }, () => {
  let userId: string;
  let otherId: string;
  before(async () => {
    userId = await h.makeUser();
    otherId = await h.makeUser();
  });

  it("deletes the caller's projects, skips already-deleted ones and refuses someone else's", async () => {
    const actor = { id: userId, admin: false };
    const a = await h.makeProject(userId, "done");
    const b = await h.makeProject(userId, "done");
    const theirs = await h.makeProject(otherId, "done");
    await h.pool.query(`update projects set deleted_at = now() where id = $1`, [b]);

    const r = await deleteProjects(h.svc, actor, [a, b, theirs, a]);
    assert.equal(r.deleted, 1);
    assert.equal(r.skipped, 0); // b is already deleted: not found among live projects, so it fails rather than skips
    assert.equal(r.failed, 2);
    assert.equal(r.results.length, 3, "duplicate ids are dropped");
    const { rows } = await h.pool.query<{ id: string; deleted: boolean }>(`select id, deleted_at is not null as deleted from projects where id = any($1)`, [
      [a, theirs],
    ]);
    assert.deepEqual(Object.fromEntries(rows.map((x) => [x.id, x.deleted])), { [a]: true, [theirs]: false });
  });

  it("throws the first error when nothing succeeded", async () => {
    const theirs = await h.makeProject(otherId, "done");
    await assert.rejects(deleteProjects(h.svc, { id: userId, admin: false }, [theirs]), (e: unknown) => e instanceof TRPCError && e.code === "NOT_FOUND");
  });

  it("retries only failed projects", async () => {
    const actor = { id: userId, admin: false };
    const failed = await h.makeProject(userId, "failed");
    const done = await h.makeProject(userId, "done");
    const r = await retryProjects(h.svc, actor, [failed, done]);
    assert.equal(r.retried, 1);
    assert.equal(r.skipped, 1);
    const { rows } = await h.pool.query<{ status: string }>(`select status from projects where id = $1`, [done]);
    assert.equal(rows[0]!.status, "done");
  });

  it("re-renders the finished clips of each project", async () => {
    const actor = { id: userId, admin: false };
    const p1 = await h.makeProject(userId, "done");
    const p2 = await h.makeProject(userId, "done");
    await h.makeClip(p1, 0, "done", { outputKey: "clips/a.mp4" });
    await h.makeClip(p2, 0, "done", { outputKey: "clips/b.mp4" });
    await h.makeClip(p2, 1, "rendering");
    const r = await rerenderProjects(h.svc, actor, [p1, p2]);
    assert.equal(r.rerendered, 2);
    assert.equal(r.skipped, 1);
    assert.equal(r.failed, 0);
  });
});
