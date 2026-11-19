import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it, test } from "@effect/vitest";
import { Effect, Fiber, Logger, Schedule } from "effect";
import { Client } from "pg";
import {
  DatabaseBehindError,
  DatabaseUnreachableError,
  migrateDatabase,
  MigrationError,
  MigrationLockHeldError,
  requireMigrated,
} from "./migrate";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

const carried = NodeFS.readdirSync(NodePath.join(import.meta.dirname, "../../drizzle")).toSorted();

const query = (databaseUrl: string, text: string) =>
  Effect.promise(async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      return (await client.query<Record<string, unknown>>(text)).rows;
    } finally {
      await client.end();
    }
  });

/** A Contact's columns as the test reads them, where a row sets nothing. */
const unset = {
  deleted: null,
  first_name: null,
  properties: null,
  reason: null,
  severity: null,
  suppressed: null,
  unsubscribed: false,
};

/** A database of this test's own on the run's Postgres: the shared one is already migrated. */
const emptyDatabase = (serverUrl: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const name = `migrate_test_${Bun.randomUUIDv7().replaceAll("-", "")}`;
      yield* query(serverUrl, `create database "${name}"`);
      const url = new URL(serverUrl);
      url.pathname = `/${name}`;
      return { name, url: url.href };
    }),
    ({ name }) => query(serverUrl, `drop database "${name}" with (force)`),
  ).pipe(Effect.map(({ url }) => url));

/** Another run's advisory lock on the database, held until the test lets go of it. */
const lockHolder = (databaseUrl: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const client = new Client({ application_name: "another-run", connectionString: databaseUrl });
      await client.connect();
      await client.query("select pg_advisory_lock(872014331, 1)");
      return client;
    }),
    (client) => Effect.promise(() => client.end()),
  );

/** The step's own sessions on the database: it names itself to Postgres. */
const stepSessions = `from pg_stat_activity
  where datname = current_database() and application_name = 'relayit-migrate'`;

const constraintMigration = carried.findIndex((name) =>
  NodeFS.readFileSync(
    NodePath.join(import.meta.dirname, "../../drizzle", name, "migration.sql"),
    "utf8",
  ).includes("contact_email_normalized_check"),
);

/**
 * Migrates the database to where the release before `contact_email_normalized_check` left
 * it: every migration but that one and any after it, applied by the step from a folder
 * holding only those. The step still has that migration to run, on a table with rows.
 */
const migrateToBeforeTheConstraint = (databaseUrl: string) =>
  Effect.gen(function* () {
    const before = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const folder = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "migrate-test-"));
        for (const name of carried.slice(0, constraintMigration)) {
          NodeFS.cpSync(
            NodePath.join(import.meta.dirname, "../../drizzle", name),
            NodePath.join(folder, name),
            { recursive: true },
          );
        }
        return folder;
      }),
      (folder) => Effect.sync(() => NodeFS.rmSync(folder, { force: true, recursive: true })),
    );
    yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = process.env.DRIZZLE_MIGRATIONS_FOLDER;
        process.env.DRIZZLE_MIGRATIONS_FOLDER = before;
        return previous;
      }),
      () => migrateDatabase({ databaseUrl, waitFor: 0 }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) {
            delete process.env.DRIZZLE_MIGRATIONS_FOLDER;
          } else {
            process.env.DRIZZLE_MIGRATIONS_FOLDER = previous;
          }
        }),
    );
  });

const applied = (databaseUrl: string) =>
  query(databaseUrl, "select name from drizzle.__drizzle_migrations order by name").pipe(
    Effect.map((rows) => rows.map((row) => row.name)),
  );

describe("the migrate step and the apps' check for it", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping migrate integration tests: TEST_DATABASE_URL is not set");
    test.skip("migrates an empty database once", () => undefined);
    return;
  }

  it.live("two steps at once migrate an empty database once, and a later one changes nothing", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);

      yield* Effect.all(
        [
          migrateDatabase({ databaseUrl, waitFor: 0 }),
          migrateDatabase({ databaseUrl, waitFor: 0 }),
        ],
        { concurrency: "unbounded" },
      );
      expect(yield* applied(databaseUrl)).toEqual(carried);

      yield* migrateDatabase({ databaseUrl, waitFor: 0 });
      expect(yield* applied(databaseUrl)).toEqual(carried);
      yield* requireMigrated({ databaseUrl, waitFor: 0 });
    }).pipe(Effect.scoped),
  );

  it.live("the step fails when it cannot migrate, without trying again", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      // The first migration creates this type, so it fails and the whole run rolls back.
      yield* query(databaseUrl, `create type "channel" as enum ('taken')`);

      const started = Date.now();
      const error = yield* migrateDatabase({ databaseUrl, waitFor: "30 seconds" }).pipe(
        Effect.flip,
      );
      expect(error).toBeInstanceOf(MigrationError);
      // The wait is for a connection only: a second attempt would come two seconds later.
      expect(Date.now() - started).toBeLessThan(2000);
      expect(yield* applied(databaseUrl)).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.live("the step fails with why when its connection is lost, and the next one migrates", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      // Another step's lock, held so this one is still waiting when its connection goes.
      const holder = yield* lockHolder(databaseUrl);

      const step = yield* Effect.forkChild(
        migrateDatabase({ databaseUrl, waitFor: "30 seconds" }).pipe(Effect.flip),
      );
      yield* query(databaseUrl, `select pid ${stepSessions}`).pipe(
        Effect.repeat({
          until: (rows) => rows.length === 1,
          // Bounded, so a step that never connects fails the assertion below rather than
          // the test's timeout.
          schedule: Schedule.spaced("50 millis").pipe(Schedule.upTo({ duration: "3 seconds" })),
        }),
      );
      expect(
        yield* query(databaseUrl, `select pg_terminate_backend(pid) ${stepSessions}`),
      ).toHaveLength(1);

      const error = yield* Fiber.join(step);
      expect(error).toBeInstanceOf(MigrationError);
      // Postgres's own words (57P01, admin_shutdown), not pg's for a client it gave up on.
      expect(error).toMatchObject({ cause: { code: "57P01" } });
      // Nothing ran: Drizzle makes its table only once it has the lock.
      expect(
        yield* query(databaseUrl, "select to_regclass('drizzle.__drizzle_migrations') as made"),
      ).toEqual([{ made: null }]);

      yield* Effect.promise(() => holder.query("select pg_advisory_unlock(872014331, 1)"));
      yield* migrateDatabase({ databaseUrl, waitFor: 0 });
      expect(yield* applied(databaseUrl)).toEqual(carried);
    }).pipe(Effect.scoped),
  );

  it.live("the step normalizes stored Contact emails and merges the ones that then collide", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      expect(constraintMigration).toBeGreaterThan(0);
      yield* migrateToBeforeTheConstraint(databaseUrl);
      expect(yield* applied(databaseUrl)).toEqual(carried.slice(0, constraintMigration));

      yield* query(
        databaseUrl,
        `insert into organization (id, name, slug, created_at, updated_at)
            values ('orgn_a', 'A', 'a', now(), now()), ('orgn_b', 'B', 'b', now(), now());
          insert into organization_app_environment (id, organization_id, updated_at)
            values ('oenv_a', 'orgn_a', now()), ('oenv_b', 'orgn_b', now());
          insert into topic (id, organization_id, name, updated_at) values
            ('topc_news', 'orgn_a', 'News', now()), ('topc_offers', 'orgn_a', 'Offers', now());
          insert into segment (id, organization_id, name, updated_at) values
            ('segm_all', 'orgn_a', 'All', now()), ('segm_vip', 'orgn_a', 'VIP', now());
          insert into contact
            (id, organization_app_environment_id, email, first_name, properties, unsubscribed,
             suppression_severity, suppression_reason, suppressed_at, deleted_at, created_at,
             updated_at)
          values
            -- Alone in another case with whitespace around it, as from a file, suppressed.
            ('cont_alone', 'oenv_a', E' Alone@Example.com\\r\\n', null, '{}', false,
             'all', 'hard_bounce', '2026-01-01', null, '2026-01-01', now()),
            -- A pair: the lower-case row sends have been finding, and a stricter older one.
            ('cont_pair_lower', 'oenv_a', 'pair@example.com', null, '{"plan":"pro","a":"lower"}',
             false, 'marketing', 'complaint', '2026-03-01', null, '2026-02-01', now()),
            ('cont_pair_mixed', 'oenv_a', 'Pair@Example.com', 'Pat', '{"a":"mixed","b":"mixed"}',
             true, 'all', 'hard_bounce', '2026-01-15', '2026-01-20', '2026-01-01', now()),
            -- Three with no lower-case row among them; only the newest is suppressed.
            ('cont_three_a', 'oenv_a', 'Three@example.com', null, null, false,
             null, null, null, null, '2026-01-01', now()),
            ('cont_three_b', 'oenv_a', 'THREE@example.com', null, null, false,
             null, null, null, null, '2026-01-02', now()),
            ('cont_three_c', 'oenv_a', 'three@Example.com', null, null, false,
             'marketing', 'manual', '2026-01-03', null, '2026-01-03', now()),
            -- Every row of the address deleted: it stays deleted.
            ('cont_gone', 'oenv_a', 'Gone@example.com', null, null, false,
             null, null, null, '2026-01-05', '2026-01-01', now()),
            -- The same address in another Project's App Environment is another Contact.
            ('cont_other', 'oenv_b', 'pair@example.com', null, null, false,
             null, null, null, null, '2026-01-01', now()),
            ('cont_untouched', 'oenv_a', 'plain@example.com', 'Plain', '{"k":"v"}', false,
             null, null, null, null, '2026-01-01', '2026-01-01');
          insert into contact_topic_unsubscribe (id, contact_id, topic_id) values
            ('ctun_1', 'cont_pair_lower', 'topc_news'),
            ('ctun_2', 'cont_pair_mixed', 'topc_news'),
            ('ctun_3', 'cont_pair_mixed', 'topc_offers'),
            ('ctun_4', 'cont_three_b', 'topc_news'),
            ('ctun_5', 'cont_three_c', 'topc_news');
          insert into segment_member (id, segment_id, contact_id) values
            ('sgmb_1', 'segm_all', 'cont_pair_lower'),
            ('sgmb_2', 'segm_all', 'cont_pair_mixed'),
            ('sgmb_3', 'segm_vip', 'cont_pair_mixed'),
            ('sgmb_4', 'segm_vip', 'cont_three_b');`,
      );

      // The previous release unsubscribing a Contact that is about to be merged away, not
      // yet committed when the step starts.
      const unsubscribing = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const client = new Client({ connectionString: databaseUrl });
          await client.connect();
          await client.query("begin");
          await client.query(
            `insert into contact_topic_unsubscribe (id, contact_id, topic_id)
              values ('ctun_late', 'cont_three_c', 'topc_offers')`,
          );
          return client;
        }),
        (client) => Effect.promise(() => client.end()),
      );

      // Twice at once, as two releases' steps would: one normalizes, the other finds it done.
      const steps = yield* Effect.forkChild(
        Effect.all(
          [
            migrateDatabase({ databaseUrl, waitFor: 0 }),
            migrateDatabase({ databaseUrl, waitFor: 0 }),
          ],
          { concurrency: "unbounded" },
        ),
      );
      // One step is waiting behind the unsubscribe (the other asks for the first's advisory
      // lock every two seconds), so the unsubscribe commits while a step is under way. That
      // it is kept is asserted below.
      const waiting = yield* query(
        databaseUrl,
        `select pid from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
      ).pipe(
        Effect.repeat({
          until: (rows) => rows.length === 1,
          schedule: Schedule.spaced("50 millis").pipe(Schedule.upTo({ duration: "5 seconds" })),
        }),
      );
      // Not reached in time would mean the commit below came first and nothing was raced.
      expect(waiting).toHaveLength(1);
      expect(
        yield* query(databaseUrl, "select email from contact where id = 'cont_alone'"),
      ).toEqual([{ email: " Alone@Example.com\r\n" }]);
      yield* Effect.promise(() => unsubscribing.query("commit"));
      yield* Fiber.join(steps);
      expect(yield* applied(databaseUrl)).toEqual(carried);

      expect(
        yield* query(
          databaseUrl,
          `select id, organization_app_environment_id as env, email, first_name, properties,
              unsubscribed, suppression_severity as severity, suppression_reason as reason,
              to_char(suppressed_at, 'YYYY-MM-DD') as suppressed,
              to_char(deleted_at, 'YYYY-MM-DD') as deleted,
              to_char(created_at, 'YYYY-MM-DD') as created
            from contact order by id`,
        ),
      ).toEqual([
        {
          ...unset,
          created: "2026-01-01",
          email: "alone@example.com",
          env: "oenv_a",
          id: "cont_alone",
          properties: {},
          reason: "hard_bounce",
          severity: "all",
          suppressed: "2026-01-01",
        },
        {
          ...unset,
          created: "2026-01-01",
          deleted: "2026-01-05",
          email: "gone@example.com",
          env: "oenv_a",
          id: "cont_gone",
        },
        {
          ...unset,
          created: "2026-01-01",
          email: "pair@example.com",
          env: "oenv_b",
          id: "cont_other",
        },
        {
          // The stricter Suppression and the opt-out of the row that went, on the row that
          // was live, which stays live.
          created: "2026-01-01",
          deleted: null,
          email: "pair@example.com",
          env: "oenv_a",
          first_name: "Pat",
          id: "cont_pair_lower",
          properties: { a: "lower", b: "mixed", plan: "pro" },
          reason: "hard_bounce",
          severity: "all",
          suppressed: "2026-01-15",
          unsubscribed: true,
        },
        {
          ...unset,
          created: "2026-01-01",
          email: "three@example.com",
          env: "oenv_a",
          id: "cont_three_a",
          reason: "manual",
          severity: "marketing",
          suppressed: "2026-01-03",
        },
        {
          ...unset,
          created: "2026-01-01",
          email: "plain@example.com",
          env: "oenv_a",
          first_name: "Plain",
          id: "cont_untouched",
          properties: { k: "v" },
        },
      ]);
      // A Contact the step had no reason to touch is not written.
      expect(
        yield* query(
          databaseUrl,
          "select to_char(updated_at, 'YYYY-MM-DD') as updated from contact where id = 'cont_untouched'",
        ),
      ).toEqual([{ updated: "2026-01-01" }]);
      expect(
        yield* query(
          databaseUrl,
          "select contact_id, topic_id from contact_topic_unsubscribe order by 1, 2",
        ),
      ).toEqual([
        { contact_id: "cont_pair_lower", topic_id: "topc_news" },
        { contact_id: "cont_pair_lower", topic_id: "topc_offers" },
        { contact_id: "cont_three_a", topic_id: "topc_news" },
        // Made while the step waited, on a Contact the step then removed.
        { contact_id: "cont_three_a", topic_id: "topc_offers" },
      ]);

      // What the constraint is for: an address is stored one way only.
      const refused = yield* Effect.tryPromise(async () => {
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
          await client.query(
            `insert into contact (id, organization_app_environment_id, email, updated_at)
              values ('cont_spaced', 'oenv_a', E'spaced@example.com\\r', now())`,
          );
        } finally {
          await client.end();
        }
      }).pipe(Effect.flip);
      expect(refused.cause).toMatchObject({ constraint: "contact_email_normalized_check" });
      expect(
        yield* query(
          databaseUrl,
          "select contact_id, segment_id from segment_member order by 1, 2",
        ),
      ).toEqual([
        { contact_id: "cont_pair_lower", segment_id: "segm_all" },
        { contact_id: "cont_pair_lower", segment_id: "segm_vip" },
        { contact_id: "cont_three_a", segment_id: "segm_vip" },
      ]);
    }).pipe(Effect.scoped),
  );

  it.live(
    "the step fails naming the lock when another session holds it past the lock wait, having said it was waiting",
    () => {
      const warnings: string[] = [];
      return Effect.gen(function* () {
        const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
        const holder = yield* lockHolder(databaseUrl);

        const started = Date.now();
        const error = yield* migrateDatabase({
          databaseUrl,
          lockWaitFor: "3 seconds",
          waitFor: 0,
        }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(MigrationLockHeldError);
        expect(error.message).toContain("holds the migrate step's advisory lock");
        // Who to look for: the holder's pid and the name it gave Postgres.
        const [{ pid }] = (yield* Effect.promise(() =>
          holder.query<{ pid: number }>("select pg_backend_pid() as pid"),
        )).rows as [{ pid: number }];
        expect(error).toMatchObject({
          holder: expect.stringMatching(new RegExp(`^pid ${pid} another-run connected .* idle$`)),
        });
        // It asked more than once, and said so each time it was refused.
        expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
        expect(warnings.length).toBeGreaterThanOrEqual(2);
        expect(new Set(warnings)).toEqual(
          new Set([
            JSON.stringify(["Waiting for the migrate step's lock: another session holds it"]),
          ]),
        );
        expect(
          yield* query(databaseUrl, "select to_regclass('drizzle.__drizzle_migrations') as made"),
        ).toEqual([{ made: null }]);
        // Its session is gone, so the lock is the next run's as soon as the holder lets go.
        expect(yield* query(databaseUrl, `select pid ${stepSessions}`)).toEqual([]);

        yield* Effect.promise(() => holder.query("select pg_advisory_unlock(872014331, 1)"));
        yield* migrateDatabase({ databaseUrl, waitFor: 0 });
        expect(yield* applied(databaseUrl)).toEqual(carried);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Logger.layer([
            Logger.make(({ logLevel, message }) => {
              if (logLevel === "Warn") {
                warnings.push(JSON.stringify(message));
              }
            }),
          ]),
        ),
      );
    },
  );

  it.live(
    "the step fails when a migration cannot have its table lock in time, and migrates once it can",
    () =>
      Effect.gen(function* () {
        const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
        yield* migrateToBeforeTheConstraint(databaseUrl);
        // A session left idle in a transaction that has read `contact`. The normalization's
        // lock lets readers by; the migration's ALTER TABLE does not.
        const reader = yield* Effect.acquireRelease(
          Effect.promise(async () => {
            const client = new Client({ connectionString: databaseUrl });
            await client.connect();
            await client.query("begin; select count(*) from contact");
            return client;
          }),
          (client) => Effect.promise(() => client.end()),
        );

        const error = yield* migrateDatabase({
          databaseUrl,
          tableLockWaitFor: "1 second",
          waitFor: 0,
        }).pipe(Effect.flip);
        expect(error).toBeInstanceOf(MigrationError);
        // lock_not_available: Postgres gave up the wait, not a statement that was running.
        expect(error).toMatchObject({ cause: { cause: { code: "55P03" } } });
        // The run rolled back whole.
        expect(yield* applied(databaseUrl)).toEqual(carried.slice(0, constraintMigration));

        yield* Effect.promise(() => reader.query("commit"));
        yield* migrateDatabase({ databaseUrl, tableLockWaitFor: "1 second", waitFor: 0 });
        expect(yield* applied(databaseUrl)).toEqual(carried);
      }).pipe(Effect.scoped),
  );

  it.live("the step fails when Postgres stops answering it, and does not hang ending", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      yield* lockHolder(databaseUrl);
      // Between the step and Postgres, so the test can stop passing bytes either way while
      // both connections stay open: a peer that neither answers nor closes.
      const upstream = new URL(databaseUrl);
      const sockets: NodeNet.Socket[] = [];
      const proxy = yield* Effect.acquireRelease(
        Effect.callback<NodeNet.Server>((resume) => {
          const server = NodeNet.createServer((downstream) => {
            const up = NodeNet.connect(Number(upstream.port || 5432), upstream.hostname);
            sockets.push(downstream, up);
            downstream.on("error", () => undefined).pipe(up);
            up.on("error", () => undefined).pipe(downstream);
          });
          server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)));
        }),
        (server) =>
          Effect.sync(() => {
            for (const socket of sockets) {
              socket.destroy();
            }
            server.close();
          }),
      );
      const through = new URL(databaseUrl);
      through.hostname = "127.0.0.1";
      through.port = String((proxy.address() as NodeNet.AddressInfo).port);

      const step = yield* Effect.forkChild(
        migrateDatabase({ databaseUrl: through.href, waitFor: 0 }).pipe(Effect.flip),
      );
      yield* query(databaseUrl, `select pid ${stepSessions}`).pipe(
        Effect.repeat({
          until: (rows) => rows.length === 1,
          schedule: Schedule.spaced("50 millis").pipe(Schedule.upTo({ duration: "3 seconds" })),
        }),
      );
      for (const socket of sockets) {
        socket.unpipe();
        socket.pause();
      }
      const silenced = Date.now();

      const error = yield* Fiber.join(step);
      expect(error).toBeInstanceOf(MigrationError);
      expect(error).toMatchObject({
        cause: { message: "Postgres did not answer within 10 seconds" },
      });
      // Its next question, at most two seconds off, ten for the answer, five to end a
      // session that never says goodbye.
      expect(Date.now() - silenced).toBeLessThan(20_000);
    }).pipe(Effect.scoped),
  );

  it.live("the step started before its database takes connections waits, then migrates it", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      const name = new URL(databaseUrl).pathname.slice(1);
      yield* query(testDatabaseUrl, `alter database "${name}" allow_connections false`);

      const step = yield* Effect.forkChild(migrateDatabase({ databaseUrl, waitFor: "30 seconds" }));
      yield* Effect.sleep("500 millis");
      expect(step.pollUnsafe()).toBeUndefined();

      yield* query(testDatabaseUrl, `alter database "${name}" allow_connections true`);
      yield* Fiber.join(step);
      expect(yield* applied(databaseUrl)).toEqual(carried);
    }).pipe(Effect.scoped),
  );

  it.live(
    "the step whose database never takes connections fails with why, once its wait is over",
    () =>
      Effect.gen(function* () {
        const started = Date.now();
        // Nothing listens on port 1.
        const error = yield* migrateDatabase({
          databaseUrl: "postgres://postgres:postgres@127.0.0.1:1/relayit",
          waitFor: "1 second",
        }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(DatabaseUnreachableError);
        expect(error).toMatchObject({ cause: { code: "ECONNREFUSED" } });
        // Not at the first refusal: it tried again two seconds later.
        expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
      }),
  );

  it.live("an app refuses a database that was never migrated, or lacks its newest migration", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);

      const never = yield* requireMigrated({ databaseUrl, waitFor: 0 }).pipe(Effect.flip);
      expect(never).toBeInstanceOf(DatabaseBehindError);
      expect(never).toMatchObject({ missing: carried });

      yield* migrateDatabase({ databaseUrl, waitFor: 0 });
      const newest = carried.at(-1);
      yield* query(
        databaseUrl,
        `delete from drizzle.__drizzle_migrations where name = '${newest}'`,
      );
      const behind = yield* requireMigrated({ databaseUrl, waitFor: 0 }).pipe(Effect.flip);
      expect(behind).toMatchObject({ missing: [newest] });
    }).pipe(Effect.scoped),
  );

  it.live("an app starts against a database a newer release has already migrated", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      yield* migrateDatabase({ databaseUrl, waitFor: 0 });
      yield* query(
        databaseUrl,
        `insert into drizzle.__drizzle_migrations (hash, created_at, name)
         values ('newer', 99990101000000, '99990101000000_from_a_newer_release')`,
      );

      yield* requireMigrated({ databaseUrl, waitFor: 0 });
    }).pipe(Effect.scoped),
  );

  it.live("an app started before the step has finished waits for it, then starts", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);

      const app = yield* Effect.forkChild(requireMigrated({ databaseUrl, waitFor: "30 seconds" }));
      yield* Effect.sleep("500 millis");
      expect(app.pollUnsafe()).toBeUndefined();

      yield* migrateDatabase({ databaseUrl, waitFor: 0 });
      yield* Fiber.join(app);
    }).pipe(Effect.scoped),
  );

  it.live("an app started before its database takes connections waits, then starts", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      const name = new URL(databaseUrl).pathname.slice(1);
      yield* query(testDatabaseUrl, `alter database "${name}" allow_connections false`);
      // Refused, not merely behind: an empty database would keep the app waiting too.
      const refused = yield* Effect.tryPromise(() =>
        new Client({ connectionString: databaseUrl }).connect(),
      ).pipe(Effect.flip);
      expect(refused).toMatchObject({ cause: { code: "55000" } });

      const app = yield* Effect.forkChild(requireMigrated({ databaseUrl, waitFor: "30 seconds" }));
      yield* Effect.sleep("500 millis");
      expect(app.pollUnsafe()).toBeUndefined();

      yield* query(testDatabaseUrl, `alter database "${name}" allow_connections true`);
      yield* migrateDatabase({ databaseUrl, waitFor: 0 });
      yield* Fiber.join(app);
    }).pipe(Effect.scoped),
  );

  it.live(
    "an app whose database never takes connections fails with why, once its wait is over",
    () =>
      Effect.gen(function* () {
        const started = Date.now();
        // Nothing listens on port 1.
        const error = yield* requireMigrated({
          databaseUrl: "postgres://postgres:postgres@127.0.0.1:1/relayit",
          waitFor: "1 second",
        }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(DatabaseUnreachableError);
        expect(error).toMatchObject({ cause: { code: "ECONNREFUSED" } });
        // Not at the first refusal: it tried again two seconds later.
        expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
      }).pipe(Effect.scoped),
  );
});
