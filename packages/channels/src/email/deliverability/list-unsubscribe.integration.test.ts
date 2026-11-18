import { describe, expect, it, test } from "@effect/vitest";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  contact,
  contactTopicUnsubscribe,
  message,
  organization,
  organizationAppEnvironment,
  topic,
} from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { typeid } from "typeid-js";
import { handleListUnsubscribeOneClick, signListUnsubscribe } from "./list-unsubscribe";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

/** A Project with an App Environment, a Contact, a Topic and a Message of `purpose`. */
const seedProject = (purpose: "marketing" | "transactional") =>
  Effect.gen(function* () {
    const db = yield* DB;
    const ids = {
      contactId: typeid("cont").toString(),
      environmentId: typeid("oenv").toString(),
      messageId: typeid("msg").toString(),
      organizationId: typeid("orgn").toString(),
      topicId: typeid("topc").toString(),
    };
    yield* db.insert(organization).values({
      id: ids.organizationId,
      name: "Unsubscribe",
      slug: `unsub-${Bun.randomUUIDv7()}`,
    });
    yield* db
      .insert(organizationAppEnvironment)
      .values({ id: ids.environmentId, organizationId: ids.organizationId });
    yield* db.insert(contact).values({
      email: "reader@example.com",
      id: ids.contactId,
      organizationAppEnvironmentId: ids.environmentId,
    });
    yield* db
      .insert(topic)
      .values({ id: ids.topicId, name: "News", organizationId: ids.organizationId });
    yield* db
      .insert(message)
      .values({ id: ids.messageId, organizationAppEnvironmentId: ids.environmentId, purpose });
    return ids;
  });

const unsubscribesOf = (contactId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    return yield* db
      .select({ topicId: contactTopicUnsubscribe.topicId })
      .from(contactTopicUnsubscribe)
      .where(eq(contactTopicUnsubscribe.contactId, contactId));
  });

describe("handleListUnsubscribeOneClick", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping List-Unsubscribe tests: TEST_DATABASE_URL is not set");
    // The PostgreSQL test is opt-in.
    test.skip("List-Unsubscribe against PostgreSQL", () => undefined);
    return;
  }

  const dbLive = makeDbLive({ databaseUrl: testDatabaseUrl });

  it.live("unsubscribes through a link signed before a rotation, after a rename", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const project = yield* seedProject("marketing");
      const signature = signListUnsubscribe({
        contactId: project.contactId,
        messageId: project.messageId,
        secret: "old-secret",
        topicId: project.topicId,
      });
      yield* db
        .update(organization)
        .set({ slug: `renamed-${Bun.randomUUIDv7()}` })
        .where(eq(organization.id, project.organizationId));

      const result = yield* handleListUnsubscribeOneClick({
        contactId: project.contactId,
        messageId: project.messageId,
        secrets: ["new-secret", "old-secret"],
        signature,
        topicId: project.topicId,
      });

      expect(result).toEqual({ contactId: project.contactId, ok: true, topicId: project.topicId });
      expect(yield* unsubscribesOf(project.contactId)).toEqual([{ topicId: project.topicId }]);
    }).pipe(Effect.provide(dbLive)),
  );

  it.live("refuses a Topic or Message of another Project, though signed", () =>
    Effect.gen(function* () {
      const project = yield* seedProject("marketing");
      const other = yield* seedProject("marketing");

      for (const link of [
        { messageId: project.messageId, topicId: other.topicId, expected: "Topic not found" },
        { messageId: other.messageId, topicId: project.topicId, expected: "Message not found" },
      ]) {
        const error = yield* handleListUnsubscribeOneClick({
          contactId: project.contactId,
          messageId: link.messageId,
          secrets: ["secret"],
          signature: signListUnsubscribe({
            contactId: project.contactId,
            messageId: link.messageId,
            secret: "secret",
            topicId: link.topicId,
          }),
          topicId: link.topicId,
        }).pipe(Effect.flip);
        expect({ code: error.code, message: error.message }).toEqual({
          code: "not_found",
          message: link.expected,
        });
      }
      expect(yield* unsubscribesOf(project.contactId)).toEqual([]);
    }).pipe(Effect.provide(dbLive)),
  );

  it.live("refuses a transactional Message", () =>
    Effect.gen(function* () {
      const project = yield* seedProject("transactional");

      const error = yield* handleListUnsubscribeOneClick({
        contactId: project.contactId,
        messageId: project.messageId,
        secrets: ["secret"],
        signature: signListUnsubscribe({
          contactId: project.contactId,
          messageId: project.messageId,
          secret: "secret",
          topicId: project.topicId,
        }),
        topicId: project.topicId,
      }).pipe(Effect.flip);

      expect(error.code).toBe("bad_request");
      expect(yield* unsubscribesOf(project.contactId)).toEqual([]);
    }).pipe(Effect.provide(dbLive)),
  );
});
