import { describe, expect, it, test } from "@effect/vitest";
import { Jobs, type JobsService } from "@repo/jobs";
import { type Database, DB, makeDbLive } from "@repo/persistence/db/effect";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { EmailBackend, type EmailBackendService } from "../backend";
import { emailRecheckProjectSendingPauseHandler } from "./project-sending-pause";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testName =
  "a worker started before the api has migrated finds no pause to recheck, and starts";

describe("the recheck job when a worker starts (PostgreSQL)", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping the recheck job's start test: TEST_DATABASE_URL unset");
    // The PostgreSQL test is opt-in.
    test.skip(testName, () => undefined);
    return;
  }

  it.live(testName, () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const atStart = emailRecheckProjectSendingPauseHandler.reconcile;
      if (!atStart) {
        return yield* Effect.die("the recheck job has nothing to do when a worker starts");
      }
      const scheduled: unknown[] = [];
      const schema = `before_${Bun.randomUUIDv7().replaceAll("-", "")}`;

      // The database as it is before the migration that adds `project_sending_pause`: the
      // tables the job reads, with the reason's enum as it was, in a schema of their own
      // that goes when the transaction does.
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.execute(sql.raw(`create schema ${schema}`));
            yield* tx.execute(sql.raw(`set local search_path to ${schema}`));
            yield* tx.execute(
              sql.raw(
                `create type ${schema}.domain_paused_reason as enum ('bad_reputation', 'manual_admin_pause')`,
              ),
            );
            for (const table of [
              "custom_domain",
              "organization_domain",
              "email_domain_provider_identity",
            ]) {
              yield* tx.execute(sql.raw(`create table ${schema}.${table} (like public.${table})`));
            }
            yield* tx.execute(
              sql.raw(
                `alter table ${schema}.custom_domain alter column paused_reason type ${schema}.domain_paused_reason using null`,
              ),
            );
            // A Domain an admin paused, held and registered: a row the query has to weigh.
            yield* tx.execute(
              sql.raw(`insert into ${schema}.custom_domain
                (id, fqdn, dkim_selector, dkim_public_key, dkim_private_key, verification_status, provider, is_paused, paused_reason, verify_backoff_level, created_at)
                values ('domn_before', 'before.relayit.test', 'relayit', 'unused', 'unused', 'verified', 'unknown', true, 'bad_reputation', 0, now())`),
            );
            yield* tx.execute(
              sql.raw(`insert into ${schema}.organization_domain
                (organization_id, custom_domain_id, ownership_verification_status, ownership_token, ownership_backoff_level, created_at)
                values ('orgn_before', 'domn_before', 'verified', 'token', 0, now())`),
            );
            yield* tx.execute(
              sql.raw(`insert into ${schema}.email_domain_provider_identity
                (id, custom_domain_id, verification_status, created_at)
                values ('epid_before', 'domn_before', 'verified', now())`),
            );

            yield* atStart.pipe(
              // The job reads through the transaction, so through that schema.
              Effect.provideService(DB, tx as unknown as Database),
              Effect.provideService(EmailBackend, {
                defaultRegion: "eu-central-1",
              } as EmailBackendService),
              Effect.provideService(Jobs, {
                schedule: (_contract: unknown, payload: unknown) => {
                  scheduled.push(payload);
                  return Effect.void;
                },
              } as unknown as JobsService),
            );
            yield* tx.execute(sql.raw(`drop schema ${schema} cascade`));
          }),
        )
        .pipe(Effect.orDie);

      expect(scheduled).toEqual([]);
    }).pipe(Effect.provide(makeDbLive({ databaseUrl: testDatabaseUrl }))),
  );
});
