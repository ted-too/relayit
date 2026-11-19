import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import { member, organization } from "@repo/persistence/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";

/**
 * A Project's Billing User as SQL over a row of `organization`, null when it has none: the
 * one recorded on it, else its owner. Only a Project whose Billing User was deleted, or made
 * before one was recorded, falls to its owner, and of several owners it is the one who has
 * been a member longest (by id between two who joined at the same instant). Usage, the
 * Plan's Domain limit and the guard on a member leaving must all name the same user, or one
 * owner is counted and locked while another is charged, so each reads it through this.
 */
export const billingUserIdOf = (db: DatabaseExecutor) =>
  sql<string | null>`coalesce(${organization.billingUserId}, (${db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organization.id), eq(member.role, "owner")))
    .orderBy(member.createdAt, member.id)
    .limit(1)}))`;

/** The Billing User of one Project; null when the Project is not found or has none. */
export const billingUserOf = (db: DatabaseExecutor, organizationId: string) =>
  db
    .select({ billingUserId: billingUserIdOf(db) })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .pipe(Effect.map(([project]) => project?.billingUserId ?? null));
