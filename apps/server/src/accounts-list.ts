/**
 * The admin's list of accounts (Users page, `list_users`, `reelsaw users`) and the filter it shares with
 * bulk actions (`bulkUsers` in accounts.ts), so "select all 1,204 matching" acts on exactly what the list
 * counted. One implementation behind every surface (PRINCIPLES: "Surfaces").
 */
import { and, desc, inArray, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ABUSE_FLAGS, type AbuseFlag, FLAG_GROUPS, type FlagGroup, flagGroupHelp, flagGroupLabel, isAbuseFlag } from "@reelsaw/shared";
import { schema, type Db } from "./db/index.js";
import type { Services } from "./services.js";
import { decodeCursor, pageOf } from "./pagination.js";
import { usageByUser } from "./quota.js";
import type { UserFilter, UserStatus, userGroupsInput, userListInput } from "./accounts-schema.js";
import { SEARCH_USERS, setSearchThreshold, userMatch, userScore, words } from "./search.js";

const U = schema.user;

/** The status the list shows, from the row's columns (a suspended account is suspended whether or not it was approved). */
export const statusOf = (r: { banned: boolean; approvedAt: Date | null }): UserStatus => (r.banned ? "suspended" : r.approvedAt ? "active" : "pending");

/**
 * The filter as SQL, minus the search words (those need `setSearchThreshold` on the same transaction, see
 * `userMatch`). Callers combine it with `userMatch(words(q))`.
 */
export function userFilterWhere(f: Omit<UserFilter, "q">): SQL | undefined {
  const status =
    f.status === "pending"
      ? sql`${U.approvedAt} is null and not ${U.banned}`
      : f.status === "active"
        ? sql`${U.approvedAt} is not null and not ${U.banned}`
        : f.status === "suspended"
          ? sql`${U.banned}`
          : undefined;
  return and(
    f.flagged ? sql`jsonb_array_length(${U.flags}) > 0` : undefined,
    f.flag ? sql`${U.flags} @> ${JSON.stringify([f.flag])}::jsonb` : undefined,
    status,
    f.verified === undefined ? undefined : sql`${U.emailVerified} = ${f.verified}`,
    f.heldBy ? sql`${U.heldBy} = ${f.heldBy}` : undefined,
    f.group ? flagGroupWhere(f.group.key) : undefined,
  );
}

/** One section of group-by-flag as SQL; `inFlagGroup` in shared is the same rule for a loaded row. */
const flagGroupWhere = (k: FlagGroup): SQL => (k === "none" ? sql`jsonb_array_length(${U.flags}) = 0` : sql`${U.flags} @> ${JSON.stringify([k])}::jsonb`);

/**
 * The filtered list in sections (Users page "Group", `list_users` groupBy, `reelsaw users --group`): every section
 * that has accounts, in FLAG_GROUPS order, with its count over the whole filter (not a loaded page), the filter
 * that lists or acts on exactly it (`group` set), and, unless `limit` is 0, its first page from `listUsers`.
 * `total` counts each account once, though one with two flags is in two sections.
 */
export async function userGroups(svc: Services, input: z.input<typeof userGroupsInput>) {
  const { by, limit = 20, ...filter } = input;
  const db = svc.database.db;
  const ws = words(filter.q ?? "");
  const where = and(userMatch(ws), userFilterWhere(filter)) ?? sql`true`;
  const [byKey, [{ total } = { total: 0 }]] = await db.transaction(async (tx) => {
    await setSearchThreshold(tx);
    return Promise.all([
      // a left join keeps the accounts with no flag, as a null key
      tx.execute<{ key: string | null; n: number }>(
        sql`select f.v as key, count(*)::int as n from ${U} left join lateral jsonb_array_elements_text(${U.flags}) as f(v) on true where ${where} group by 1`,
      ),
      tx.select({ total: sql<number>`count(*)::int` }).from(U).where(where),
    ]);
  });
  const counts = new Map<FlagGroup, number>();
  for (const r of byKey.rows) {
    const k: FlagGroup | null = r.key === null ? "none" : isAbuseFlag(r.key) ? r.key : null;
    if (k) counts.set(k, Number(r.n));
  }
  const groups = await Promise.all(
    FLAG_GROUPS.filter((k) => counts.get(k)).map(async (key) => {
      const f: UserFilter = { ...filter, group: { by, key } };
      const page = limit > 0 ? await listUsers(svc, { ...f, limit }) : null;
      return {
        key,
        label: flagGroupLabel(key),
        help: flagGroupHelp(key),
        total: counts.get(key) ?? 0,
        /** list_users / manage_users / the bulk bar with exactly this section */
        filter: f,
        ...(page ? { items: page.items, nextCursor: page.nextCursor } : {}),
      };
    }),
  );
  return { by, total, groups };
}

/**
 * How many accounts carry each flag, and how many carry any: the Users page's "Flag" filter options. Every
 * account counts, suspended ones too, so a number is what picking that option lists.
 */
export async function flagCounts(db: Db): Promise<{ any: number } & Record<AbuseFlag, number>> {
  const [byFlag, [{ any } = { any: 0 }]] = await Promise.all([
    db.execute<{ flag: string; n: number }>(sql`select f as flag, count(*)::int as n from ${U}, jsonb_array_elements_text(${U.flags}) as f group by f`),
    db.select({ any: sql<number>`count(*)::int` }).from(U).where(sql`jsonb_array_length(${U.flags}) > 0`),
  ]);
  const out = { any, ...Object.fromEntries(ABUSE_FLAGS.map((f) => [f, 0])) } as { any: number } & Record<AbuseFlag, number>;
  for (const r of byFlag.rows) if (isAbuseFlag(r.flag)) out[r.flag] = Number(r.n);
  return out;
}

/**
 * The sort key of the unsearched list: pending first, then newest. `user_list_idx` is on exactly this
 * expression, `created_at desc, id desc`, so a page reads an index range instead of sorting every account.
 */
export const approvedRank = sql<number>`(case when ${U.approvedAt} is null then 0 else 1 end)`;

/**
 * Keyset page of accounts: pending first, then newest first, with each account's all-time usage from one
 * grouped query per metric table (see `usageByUser`) for just the page. A search returns the best
 * SEARCH_USERS matches in one page (no cursor; `total` says how many match).
 */
export async function listUsers(svc: Services, input: z.input<typeof userListInput> | undefined) {
  const db = svc.database.db;
  const limit = input?.limit ?? 50;
  const ws = words(input?.q ?? "");
  const match = userMatch(ws);
  const score = userScore(ws);
  const filter = userFilterWhere(input ?? {});
  let after: SQL | undefined;
  if (!ws.length && input?.cursor) {
    const c = decodeCursor(input.cursor, 3);
    if (!c) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid cursor" });
    after = sql`(${approvedRank} > ${Number(c[0])} or (${approvedRank} = ${Number(c[0])} and (${U.createdAt}, ${U.id}) < (${String(c[1])}::timestamp, ${String(c[2])})))`;
  }
  const pageSize = ws.length ? SEARCH_USERS : limit;
  const [fetched, [{ total } = { total: 0 }]] = await db.transaction(async (tx) => {
    await setSearchThreshold(tx);
    return Promise.all([
      tx
        .select({
          id: U.id,
          name: U.name,
          email: U.email,
          emailVerified: U.emailVerified,
          role: U.role,
          approvedAt: U.approvedAt,
          banned: U.banned,
          banReason: U.banReason,
          flags: U.flags,
          signupIp: U.signupIp,
          heldBy: U.heldBy,
          mustChangePassword: U.mustChangePassword,
          lastActiveAt: U.lastActiveAt,
          createdAt: U.createdAt,
          approved: approvedRank,
          ts: sql<string>`${U.createdAt}::text`,
        })
        .from(U)
        .where(and(match, filter, after))
        .orderBy(...(score ? [desc(score)] : []), approvedRank, desc(U.createdAt), desc(U.id))
        .limit(pageSize + 1),
      tx.select({ total: sql<number>`count(*)::int` }).from(U).where(and(match, filter)),
    ]);
  });
  const { items, nextCursor } = ws.length ? { items: fetched.slice(0, pageSize), nextCursor: null } : pageOf(fetched, limit, (r) => [r.approved, r.ts, r.id]);
  const ids = items.map((r) => r.id);
  const [usage, sessions, plans] = await Promise.all([
    usageByUser(db, null, ids),
    lastSessions(db, ids),
    svc.ee ? svc.ee.billing.plansOf(ids) : new Map<string, { plan: string; status: string }>(),
  ]);
  const usageOf = new Map(usage.map((u) => [u.id, u]));
  const lastOf = new Map(sessions.map((s) => [s.userId, s.last]));
  return {
    items: items.map(({ approved: _a, ts: _t, lastActiveAt, ...r }) => {
      const sessionLast = lastOf.get(r.id);
      const lastMs = Math.max(lastActiveAt?.getTime() ?? 0, sessionLast ? new Date(sessionLast).getTime() : 0);
      const { id: _id, projectsTotal, ...u } = usageOf.get(r.id)!;
      return {
        ...r,
        projects: projectsTotal,
        usage: u,
        status: statusOf(r),
        /** the plan in force (ee); null when this instance has no plans */
        plan: svc.ee ? (plans.get(r.id)?.plan ?? "free") : null,
        approvedAt: r.approvedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        lastActive: lastMs ? new Date(lastMs).toISOString() : null,
      };
    }),
    nextCursor,
    total,
  };
}

async function lastSessions(db: Db, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({ userId: schema.session.userId, last: sql<Date>`max(${schema.session.updatedAt})` })
    .from(schema.session)
    .where(inArray(schema.session.userId, ids))
    .groupBy(schema.session.userId);
}
