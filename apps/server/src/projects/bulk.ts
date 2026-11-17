/**
 * The Projects page selection bar: delete, retry failed and re-render several projects at once. Each project goes
 * through the same owner-facing service as its own button (own transaction, ownership checked), so one failure never
 * rolls the others back (`eachItem`). tRPC `projects.deleteMany` / `retryMany` / `rerenderMany`, the MCP tools
 * `delete_projects` / `retry_projects` / `rerender_projects` and `reelsaw delete-projects` / `retry-projects` /
 * `rerender-projects` all call these.
 */
import { z } from "zod";
import { BULK_CAP, eachItem, uniqueBy } from "../lib/each.js";
import type { Services } from "../services.js";
import { deleteOwnedProject, findProject, rerenderProjectClips, retryOwnedProject, restorableFor, type Actor } from "./service.js";

export const projectIdsInput = z.array(z.string().min(1).max(100)).min(1).max(BULK_CAP);

const ids = (projectIds: readonly string[]) => uniqueBy(projectIds, (id) => id);
const EMPTY = "Pick at least one project";

/** Soft-delete several projects (restorable like one). Already-deleted ones count as skipped. */
export async function deleteProjects(svc: Services, actor: Actor, projectIds: readonly string[], opts: { forgetDecisions?: boolean } = {}) {
  const out = await eachItem(svc, { module: "projects", action: "delete", empty: EMPTY }, ids(projectIds), (id) => deleteOwnedProject(svc, actor, id, opts));
  const results = out.map((r) => (r.ok ? { id: r.item, ok: true, changed: r.value.changed } : { id: r.item, ok: false, error: r.error }));
  const ok = out.flatMap((r) => (r.ok ? [r.value] : []));
  return {
    ok: true as const,
    deleted: ok.filter((v) => v.changed).length,
    skipped: ok.filter((v) => !v.changed).length,
    failed: out.length - ok.length,
    restorable: restorableFor(svc),
    storedBytes: ok.reduce((n, v) => n + (v.changed ? v.storedBytes : 0), 0),
    results,
  };
}

/** Resume several failed projects where each stopped. Projects that are not failed are skipped (left as they are). */
export async function retryProjects(svc: Services, actor: Actor, projectIds: readonly string[]) {
  const out = await eachItem(svc, { module: "projects", action: "retry", empty: EMPTY }, ids(projectIds), async (id) => {
    const p = await findProject(svc.database.db, actor, id, { deleted: false });
    if (p.status !== "failed") return { retried: false as const };
    const r = await retryOwnedProject(svc, actor, id);
    return { retried: true as const, queue: r.queue };
  });
  const results = out.map((r) => (r.ok ? { id: r.item, ok: true, retried: r.value.retried } : { id: r.item, ok: false, error: r.error }));
  const ok = out.flatMap((r) => (r.ok ? [r.value] : []));
  return {
    ok: true as const,
    retried: ok.filter((v) => v.retried).length,
    skipped: ok.filter((v) => !v.retried).length,
    failed: out.length - ok.length,
    results,
  };
}

/** Re-render every finished or failed clip of several projects; clips still preparing or rendering are left alone (counted in skipped). */
export async function rerenderProjects(svc: Services, actor: Actor, projectIds: readonly string[]) {
  const out = await eachItem(svc, { module: "projects", action: "rerender", empty: EMPTY }, ids(projectIds), (id) =>
    svc.tx(async (u) => {
      const p = await findProject(u.db, actor, id, { deleted: false });
      return rerenderProjectClips(svc, u, p.id);
    }),
  );
  const results = out.map((r) => (r.ok ? { id: r.item, ok: true, ...r.value } : { id: r.item, ok: false, error: r.error }));
  const ok = out.flatMap((r) => (r.ok ? [r.value] : []));
  return {
    ok: true as const,
    rerendered: ok.reduce((n, v) => n + v.queued, 0),
    skipped: ok.reduce((n, v) => n + v.skipped, 0),
    failed: out.length - ok.length,
    results,
  };
}
