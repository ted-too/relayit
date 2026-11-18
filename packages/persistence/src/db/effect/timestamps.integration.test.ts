import { describe, expect, it, test } from "@effect/vitest";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { user } from "../schema";
import { DB, makeDbLive } from "./index";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testName = "a timestamp reads back as the instant written, whatever the session time zone";

// Our columns are `timestamp` without time zone, written and read as UTC. The driver and
// Drizzle's codecs between them decide how a Date crosses the wire, so a change to either
// can shift every stored time by the session's offset without a type error.
describe("timestamp columns", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping timestamp integration test: TEST_DATABASE_URL is not set");
    test.skip(testName, () => undefined);
    return;
  }

  it.live(testName, () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const written = new Date("2026-03-04T05:06:07.890Z");

      for (const zone of ["UTC", "Pacific/Auckland"]) {
        const email = `timestamps-${zone}-${Bun.randomUUIDv7()}@example.test`;
        const read = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.execute(sql.raw(`set local time zone '${zone}'`));
            const [returned] = yield* tx
              .insert(user)
              .values({ createdAt: written, email, name: zone, updatedAt: written })
              .returning({ createdAt: user.createdAt });
            const [selected] = yield* tx
              .select({ createdAt: user.createdAt })
              .from(user)
              .where(eq(user.email, email));
            const related = yield* tx.query.user.findFirst({ where: { email } });
            const [text] = yield* tx
              .select({ createdAt: sql<string>`${user.createdAt}::text` })
              .from(user)
              .where(eq(user.email, email));
            return { related, returned, selected, text };
          }),
        );

        expect(read.returned?.createdAt.toISOString()).toBe(written.toISOString());
        expect(read.selected?.createdAt.toISOString()).toBe(written.toISOString());
        expect(read.related?.createdAt.toISOString()).toBe(written.toISOString());
        expect(read.text?.createdAt).toBe("2026-03-04 05:06:07.89");
      }
    }).pipe(Effect.provide(makeDbLive({ databaseUrl: testDatabaseUrl }))),
  );
});
