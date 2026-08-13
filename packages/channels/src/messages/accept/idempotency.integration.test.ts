import { describe, expect, test } from "bun:test";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  message,
  organization,
  organizationAppEnvironment,
} from "@repo/persistence/db/schema";
import { DateTime, Effect } from "effect";
import { typeid } from "typeid-js";
import { recordMessageIdempotency } from "./idempotency";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testName =
  "concurrent Idempotency records resolve to one Message and one replay";

describe("Message Idempotency concurrency", () => {
  if (!testDatabaseUrl) {
    process.emitWarning(
      "Skipping Idempotency concurrency test: TEST_DATABASE_URL is not set"
    );
    // biome-ignore lint/suspicious/noSkippedTests: The PostgreSQL test is opt-in.
    test.skip(testName, () => undefined);
    return;
  }

  test(testName, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* DB;
        const organizationId = typeid("orgn").toString();
        const environmentId = typeid("oenv").toString();
        const firstMessageId = typeid("msg").toString();
        const secondMessageId = typeid("msg").toString();
        const key = `idem_${Bun.randomUUIDv7()}`;
        const now = DateTime.nowUnsafe();

        yield* db.insert(organization).values({
          id: organizationId,
          name: "Idempotency concurrency",
          slug: `idem-${Bun.randomUUIDv7()}`,
        });
        yield* db.insert(organizationAppEnvironment).values({
          id: environmentId,
          organizationId,
        });
        yield* db.insert(message).values([
          {
            id: firstMessageId,
            organizationAppEnvironmentId: environmentId,
            purpose: "transactional",
          },
          {
            id: secondMessageId,
            organizationAppEnvironmentId: environmentId,
            purpose: "transactional",
          },
        ]);

        const [left, right] = yield* Effect.all(
          [
            recordMessageIdempotency(db, {
              key,
              messageId: firstMessageId,
              now,
              organizationId,
            }),
            recordMessageIdempotency(db, {
              key,
              messageId: secondMessageId,
              now,
              organizationId,
            }),
          ],
          { concurrency: "unbounded" }
        );

        expect([left.kind, right.kind].toSorted()).toEqual([
          "recorded",
          "replay",
        ]);

        const winnerMessageId =
          left.kind === "recorded" ? firstMessageId : secondMessageId;
        const replay = left.kind === "replay" ? left : right;
        expect(replay.kind).toBe("replay");
        if (replay.kind === "replay") {
          expect(replay.messageId).toBe(winnerMessageId);
        }
      }).pipe(Effect.provide(makeDbLive({ databaseUrl: testDatabaseUrl })))
    )
  );
});
