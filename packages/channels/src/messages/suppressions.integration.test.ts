import { describe, expect, it, test } from "@effect/vitest";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { contact, organization, organizationAppEnvironment } from "@repo/persistence/db/schema";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { typeid } from "typeid-js";
import { contactsAmong, filterSuppressedContacts, suppressedAmong } from "./suppressions";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

/** An App Environment with `contacts` Contacts, and the planner told about them. */
const seedAppEnvironment = (contacts: number) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const organizationId = typeid("orgn").toString();
    const organizationAppEnvironmentId = typeid("oenv").toString();
    yield* db.insert(organization).values({
      id: organizationId,
      name: "Suppressions",
      slug: `suppressions-${Bun.randomUUIDv7()}`,
    });
    yield* db
      .insert(organizationAppEnvironment)
      .values({ id: organizationAppEnvironmentId, organizationId });
    yield* db.execute(sql`
      insert into contact (id, organization_app_environment_id, email, updated_at)
      select 'cont_' || gen_random_uuid(), ${organizationAppEnvironmentId},
        'contact-' || n || '@example.com', now()
      from generate_series(1, ${contacts}) as n`);
    yield* db.execute(sql`analyze contact`);
    return { organizationAppEnvironmentId, organizationId };
  });

describe("the suppression lookup", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping suppression lookup tests: TEST_DATABASE_URL is not set");
    // The PostgreSQL test is opt-in.
    test.skip("finds suppressed Contacts through an index", () => undefined);
    return;
  }

  const services = makeDbLive({ databaseUrl: testDatabaseUrl });

  it.live("reads an App Environment's Contacts through the index, for a send and a bounce", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const { organizationAppEnvironmentId } = yield* seedAppEnvironment(5000);
      const emails = ["contact-17@example.com", "contact-4242@example.com"];

      // The strip at accept and in the worker; the Delivery's claim nests the same condition.
      const strip = yield* db.execute<{ "QUERY PLAN": string }>(
        sql`explain ${db
          .select({ email: contact.email })
          .from(contact)
          .where(
            suppressedAmong({ emails, organizationAppEnvironmentId, purpose: "transactional" }),
          )}`,
      );
      // What a bounce or complaint runs for each recipient it suppresses.
      const suppress = yield* db.execute<{ "QUERY PLAN": string }>(
        sql`explain update ${contact} set suppression_severity = 'all' where ${contactsAmong({
          emails: emails.slice(0, 1),
          organizationAppEnvironmentId,
        })}`,
      );

      for (const plan of [strip, suppress]) {
        const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
        expect(text).toContain("contact_app_env_lower_email_idx");
        expect(text).not.toContain("Seq Scan");
      }
    }).pipe(Effect.provide(services)),
  );

  it.live("strips a suppressed Contact whose stored email is not lower-case", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const { organizationAppEnvironmentId, organizationId } = yield* seedAppEnvironment(0);
      yield* db.insert(contact).values({
        email: "Bounced@Example.com",
        organizationAppEnvironmentId,
        suppressionReason: "hard_bounce",
        suppressionSeverity: "all",
      });

      const { kept, stripped } = yield* filterSuppressedContacts(db, {
        organizationAppEnvironmentId,
        organizationId,
        purpose: "transactional",
        recipients: [{ email: "bounced@example.com" }, { email: "fine@example.com" }],
      });

      expect(stripped).toEqual([{ email: "bounced@example.com" }]);
      expect(kept).toEqual([{ email: "fine@example.com" }]);
    }).pipe(Effect.provide(services)),
  );
});
