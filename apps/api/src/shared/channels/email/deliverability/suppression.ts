import type { DbOrTx } from "@repo/api/db";
import { or, sql } from "drizzle-orm";

export async function findSuppressedEmails({
  db,
  organizationAppEnvironmentId,
  emails,
  /** When set, only contacts with this Suppression severity are returned. */
  severity,
}: {
  db: DbOrTx;
  organizationAppEnvironmentId: string;
  emails: string[];
  severity?: "marketing" | "all";
}): Promise<Set<string>> {
  if (emails.length === 0) {
    return new Set();
  }

  const normalized = [...new Set(emails.map((email) => email.toLowerCase()))];

  const rows = await db.query.contact.findMany({
    where: (
      table,
      { and: combine, eq: equals, or: either, isNotNull: notNull }
    ) =>
      combine(
        equals(
          table.organizationAppEnvironmentId,
          organizationAppEnvironmentId
        ),
        severity
          ? combine(
              notNull(table.suppressionReason),
              equals(table.suppressionSeverity, severity)
            )
          : either(
              equals(table.unsubscribed, true),
              notNull(table.suppressionReason)
            ),
        or(...normalized.map((email) => sql`lower(${table.email}) = ${email}`))
      ),
    columns: { email: true },
  });

  return new Set(rows.map((row) => row.email.toLowerCase()));
}

export function stripSuppressedRecipients<T extends { email: string }>({
  recipients,
  suppressedEmails,
}: {
  recipients: T[];
  suppressedEmails: Set<string>;
}): T[] {
  return recipients.filter(
    (recipient) => !suppressedEmails.has(recipient.email.toLowerCase())
  );
}

export async function filterSuppressedRecipients<T extends { email: string }>({
  db,
  organizationAppEnvironmentId,
  recipients,
  severity,
}: {
  db: DbOrTx;
  organizationAppEnvironmentId: string;
  recipients: T[];
  severity?: "marketing" | "all";
}): Promise<T[]> {
  const suppressedEmails = await findSuppressedEmails({
    db,
    organizationAppEnvironmentId,
    emails: recipients.map((recipient) => recipient.email),
    severity,
  });

  return stripSuppressedRecipients({ recipients, suppressedEmails });
}

/** Transactional Accept/handoff: strip severity `all` only (not marketing / unsubscribe). */
export async function filterSeverityAllRecipients<T extends { email: string }>({
  db,
  organizationAppEnvironmentId,
  recipients,
}: {
  db: DbOrTx;
  organizationAppEnvironmentId: string;
  recipients: T[];
}): Promise<{ kept: T[]; stripped: T[] }> {
  const suppressedEmails = await findSuppressedEmails({
    db,
    organizationAppEnvironmentId,
    emails: recipients.map((recipient) => recipient.email),
    severity: "all",
  });

  const kept: T[] = [];
  const stripped: T[] = [];
  for (const recipient of recipients) {
    if (suppressedEmails.has(recipient.email.toLowerCase())) {
      stripped.push(recipient);
    } else {
      kept.push(recipient);
    }
  }
  return { kept, stripped };
}
