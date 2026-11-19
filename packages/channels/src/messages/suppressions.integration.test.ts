import { describe, expect, it, test } from "@effect/vitest";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  contact,
  contactTopicUnsubscribe,
  organization,
  organizationAppEnvironment,
  topic,
} from "@repo/persistence/db/schema";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { typeid } from "typeid-js";
import { contactsAmong, filterStoppedRecipients, stoppedAmong } from "./suppressions";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

/** An App Environment with `contacts` Contacts, a tenth suppressed, and the planner told. */
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
    // One in ten is suppressed: with next to none in the table the planner reads the few
    // suppressed rows by severity instead, whatever index the email has.
    yield* db.execute(sql`
      insert into contact
        (id, organization_app_environment_id, email, suppression_severity, updated_at)
      select 'cont_' || gen_random_uuid(), ${organizationAppEnvironmentId},
        'contact-' || n || '@example.com',
        case when n % 10 = 0 then 'all'::contact_suppression_severity end, now()
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
            stoppedAmong({
              emails,
              organizationAppEnvironmentId,
              purpose: "transactional",
              topicId: null,
            }),
          )}`,
      );
      // The same for a marketing send, which also asks after Unsubscribes.
      const marketingStrip = yield* db.execute<{ "QUERY PLAN": string }>(
        sql`explain ${db
          .select({ email: contact.email })
          .from(contact)
          .where(
            stoppedAmong({
              emails,
              organizationAppEnvironmentId,
              purpose: "marketing",
              topicId: "topc_any",
            }),
          )}`,
      );
      // What a bounce or complaint runs for each recipient it suppresses.
      const suppress = yield* db.execute<{ "QUERY PLAN": string }>(
        sql`explain update ${contact} set suppression_severity = 'all' where ${contactsAmong({
          emails: emails.slice(0, 1),
          organizationAppEnvironmentId,
        })}`,
      );

      // By App Environment alone, as removing one does through the foreign key. No index is on
      // that column by itself: the unique index leads with it. Asked of a small App
      // Environment, since reading most of the table is rightly a scan with any index.
      const small = yield* seedAppEnvironment(20);
      const byAppEnvironment = yield* db.execute<{ "QUERY PLAN": string }>(
        sql`explain ${db
          .select({ id: contact.id })
          .from(contact)
          .where(
            sql`${contact.organizationAppEnvironmentId} = ${small.organizationAppEnvironmentId}`,
          )}`,
      );

      for (const plan of [strip, marketingStrip, suppress, byAppEnvironment]) {
        const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
        expect(text).toContain("contact_app_env_email_unique_idx");
        expect(text).not.toContain("Seq Scan");
      }
    }).pipe(Effect.provide(services)),
  );

  it.live("strips a suppressed Contact named in another case, and stores none in one", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const { organizationAppEnvironmentId, organizationId } = yield* seedAppEnvironment(0);
      yield* db.insert(contact).values({
        email: "bounced@example.com",
        organizationAppEnvironmentId,
        suppressionReason: "hard_bounce",
        suppressionSeverity: "all",
      });

      const { kept, stripped } = yield* filterStoppedRecipients(db, {
        organizationAppEnvironmentId,
        organizationId,
        purpose: "transactional",
        recipients: [{ email: "Bounced@Example.COM" }, { email: "fine@example.com" }],
        topicId: null,
      });

      expect(stripped).toEqual([{ email: "Bounced@Example.COM", reason: "suppression" }]);
      expect(kept).toEqual([{ email: "fine@example.com" }]);

      // The lookup compares the column as stored, so a Contact stored in any other case
      // would be one its Suppression is never found on. The database refuses it.
      const refused = yield* db
        .insert(contact)
        .values({ email: "Bounced@Example.com", organizationAppEnvironmentId })
        .pipe(Effect.flip);
      expect(String(refused.cause)).toContain("contact_email_normalized_check");
    }).pipe(Effect.provide(services)),
  );

  it.live("holds a marketing send with no Topic to the opt-out of all marketing alone", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const { organizationAppEnvironmentId, organizationId } = yield* seedAppEnvironment(0);
      const [news] = yield* db
        .insert(topic)
        .values({ name: "News", organizationId })
        .returning({ id: topic.id });
      const [reader] = yield* db
        .insert(contact)
        .values({ email: "reader@example.com", organizationAppEnvironmentId })
        .returning({ id: contact.id });
      yield* db
        .insert(contact)
        .values({ email: "out@example.com", organizationAppEnvironmentId, unsubscribed: true });
      yield* db
        .insert(contactTopicUnsubscribe)
        .values({ contactId: reader?.id ?? "", topicId: news?.id ?? "" });
      const send = {
        organizationAppEnvironmentId,
        organizationId,
        recipients: [{ email: "reader@example.com" }, { email: "out@example.com" }],
      };

      const untopiced = yield* filterStoppedRecipients(db, {
        ...send,
        purpose: "marketing",
        topicId: null,
      });
      expect(untopiced.kept).toEqual([{ email: "reader@example.com" }]);
      expect(untopiced.stripped).toEqual([{ email: "out@example.com", reason: "unsubscribed" }]);

      // Under the Topic the reader left, neither is sent to; a transactional send, both.
      const topiced = yield* filterStoppedRecipients(db, {
        ...send,
        purpose: "marketing",
        topicId: news?.id ?? "",
      });
      expect(topiced.kept).toEqual([]);
      const transactional = yield* filterStoppedRecipients(db, {
        ...send,
        purpose: "transactional",
        topicId: null,
      });
      expect(transactional.stripped).toEqual([]);
    }).pipe(Effect.provide(services)),
  );
});
