import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Data, Duration, Effect, Schedule } from "effect";
import { Client } from "pg";
import { SESSION_TIME_ZONE } from "./effect";

/** Fixed identity — do not change after first deploy. */
const LOCK_KEY1 = 872_014_331;
const LOCK_KEY2 = 1;

/**
 * Source-relative path works for unbundled `bun run`. Bundled images set
 * `DRIZZLE_MIGRATIONS_FOLDER` because `import.meta.url` is the output file.
 */
const resolveMigrationsFolder = (): string => {
  const fromEnv = process.env.DRIZZLE_MIGRATIONS_FOLDER;
  const folder =
    fromEnv !== undefined && fromEnv.length > 0
      ? fromEnv
      : NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../../drizzle");
  if (!NodeFS.existsSync(folder)) {
    throw new Error(`Drizzle migrations folder not found at ${folder}`);
  }
  return folder;
};

export class DatabaseBehindError extends Data.TaggedError("DatabaseBehindError")<{
  /** The migrations this build carries that the database has not had applied. */
  readonly missing: ReadonlyArray<string>;
}> {
  override readonly message =
    "The database is missing migrations this version needs. Run the migrate step first (`bun run migrate.js` in the api image)";
}

/** No connection to the database, or, for an app's check, its query failed. */
export class DatabaseUnreachableError extends Data.TaggedError("DatabaseUnreachableError")<{
  readonly cause: unknown;
}> {
  override readonly message = "Could not reach the database";
}

/** The database was reached and the step failed; the migrations it ran rolled back whole. */
export class MigrationError extends Data.TaggedError("MigrationError")<{
  readonly cause: unknown;
}> {
  override readonly message = "Could not migrate the database";
}

/**
 * Another session holds the migrate step's advisory lock. Retried for the step's lock wait,
 * and what the step fails with when the holder outlasts it.
 */
export class MigrationLockHeldError extends Data.TaggedError("MigrationLockHeldError")<{
  /** The holding session as `pg_stat_activity` has it, for whoever has to end it. */
  readonly holder: string;
}> {
  override readonly message =
    "Another session holds the migrate step's advisory lock: another run of the step, or one that hung";
}

/**
 * Whether stored Contact emails still have to be normalized: the `contact` table is there
 * and the constraint that keeps them normalized is not. False on an empty database, where
 * there is nothing to normalize, and for good once the constraint's migration has run.
 */
const CONTACT_EMAILS_UNCHECKED = `
  select to_regclass('contact') is not null and not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('contact') and conname = 'contact_email_normalized_check'
  ) as unchecked`;

/**
 * A stored email as `normalizeContactEmail` leaves any address the api accepts: lower-case,
 * no whitespace around it.
 */
const normalized = (column: string) =>
  String.raw`lower(regexp_replace(${column}, '^\s+|\s+$', '', 'g'))`;

/**
 * Lower-cases every stored Contact email and takes the whitespace from around it, which the
 * `contact_email_normalized_check` migration then holds the table to. It is data, which a
 * generated migration cannot carry, so the step runs it first, in a transaction of its own:
 * it stays done if a migration after it fails.
 *
 * Contacts of one App Environment that then share an address become one. The survivor is the
 * row already normalized if there is one, since that is the row sends have been finding. It
 * keeps the strictest Suppression any of them had (with that row's reason and time), is
 * unsubscribed if any was, and holds every Topic unsubscribe and Segment membership among
 * them: nothing that stops a send is lost. It is deleted only if all of them were.
 *
 * The locks keep writers out of all three tables. A Suppression cannot land on a Contact
 * between its being read and removed, and neither can an unsubscribe, which locks only the
 * Contact's key and would otherwise commit and then go with the row. The previous release's
 * accepts, notifications and unsubscribes wait for the commit.
 */
const NORMALIZE_CONTACT_EMAILS = [
  "begin",
  "lock table contact, contact_topic_unsubscribe, segment_member in share row exclusive mode",
  `create temporary table contact_email_merge on commit drop as
    select
      id,
      first_value(id) over (
        partition by organization_app_environment_id, ${normalized("email")}
        order by (email = ${normalized("email")}) desc, (deleted_at is null) desc, created_at, id
      ) as survivor_id
    from contact
    where (organization_app_environment_id, ${normalized("email")}) in (
      select organization_app_environment_id, ${normalized("email")} from contact where email <> ${normalized("email")}
    )`,
  // One source of each (survivor, Topic) and (survivor, Segment) moves to the survivor, its own
  // first; the rest go with the Contacts removed below.
  `update contact_topic_unsubscribe set contact_id = kept.survivor_id
    from (
      select distinct on (merge.survivor_id, unsubscribe.topic_id) unsubscribe.id, merge.survivor_id
      from contact_topic_unsubscribe unsubscribe
      join contact_email_merge merge on merge.id = unsubscribe.contact_id
      order by
        merge.survivor_id, unsubscribe.topic_id,
        (merge.id = merge.survivor_id) desc, unsubscribe.created_at, unsubscribe.id
    ) kept
    where contact_topic_unsubscribe.id = kept.id
      and contact_topic_unsubscribe.contact_id <> kept.survivor_id`,
  `update segment_member set contact_id = kept.survivor_id
    from (
      select distinct on (merge.survivor_id, member.segment_id) member.id, merge.survivor_id
      from segment_member member
      join contact_email_merge merge on merge.id = member.contact_id
      order by
        merge.survivor_id, member.segment_id,
        (merge.id = merge.survivor_id) desc, member.created_at, member.id
    ) kept
    where segment_member.id = kept.id and segment_member.contact_id <> kept.survivor_id`,
  `update contact set
      email = ${normalized("contact.email")},
      unsubscribed = merged.unsubscribed,
      suppression_severity = strictest.suppression_severity,
      suppression_reason = strictest.suppression_reason,
      suppressed_at = strictest.suppressed_at,
      deleted_at = merged.deleted_at,
      first_name = merged.first_name,
      last_name = merged.last_name,
      properties = coalesce(merged.properties, contact.properties),
      created_at = merged.created_at,
      updated_at = now()
    from (
      select
        merge.survivor_id,
        bool_or(source.unsubscribed) as unsubscribed,
        case when bool_or(source.deleted_at is null) then null else max(source.deleted_at) end
          as deleted_at,
        min(source.created_at) as created_at,
        -- The survivor's own name where it has one, else the oldest source's.
        (array_agg(source.first_name order by (source.id = merge.survivor_id) desc, source.created_at, source.id)
          filter (where source.first_name is not null))[1] as first_name,
        (array_agg(source.last_name order by (source.id = merge.survivor_id) desc, source.created_at, source.id)
          filter (where source.last_name is not null))[1] as last_name,
        -- A key several of them have keeps the survivor's value, else the newest: the last
        -- one aggregated wins.
        (
          select jsonb_object_agg(
            property.key, property.value
            order by (holder.id = merge.survivor_id), holder.created_at, holder.id
          )
          from contact_email_merge held
          join contact holder on holder.id = held.id
          cross join lateral jsonb_each(
            case when jsonb_typeof(holder.properties) = 'object' then holder.properties end
          ) property
          where held.survivor_id = merge.survivor_id
        ) as properties,
        (array_agg(
          source.id
          order by
            (case source.suppression_severity when 'all' then 2 when 'marketing' then 1 else 0 end) desc,
            (source.id = merge.survivor_id) desc, source.suppressed_at, source.id
        ))[1] as strictest_id
      from contact_email_merge merge
      join contact source on source.id = merge.id
      group by merge.survivor_id
    ) merged
    join contact strictest on strictest.id = merged.strictest_id
    where contact.id = merged.survivor_id`,
  "delete from contact where id in (select id from contact_email_merge where id <> survivor_id)",
];

/**
 * The session holding the step's advisory lock, as much of it as says whether it is a run at
 * work or one to end: its pid, the application it named, how long it has been connected and
 * what it is doing.
 */
const LOCK_HOLDER = `
  select concat_ws(' ',
    'pid', activity.pid,
    nullif(activity.application_name, ''),
    'connected', date_trunc('second', now() - activity.backend_start),
    activity.state
  ) as holder
  from pg_locks held
  join pg_stat_activity activity on activity.pid = held.pid
  where held.locktype = 'advisory' and held.granted
    and held.classid = $1 and held.objid = $2 and held.objsubid = 2
    and held.database = (select oid from pg_database where datname = current_database())`;

/**
 * Fails one of the step's own short questions (the lock and its holder, whether there is
 * anything to normalize) that Postgres has not answered in ten seconds: a server that has
 * stopped answering while its host still does, which keepalive cannot tell from one at
 * work. Not for the normalization or the migrations, which take as long as they take.
 */
const answered = <A, R>(question: Effect.Effect<A, MigrationError, R>) =>
  question.pipe(
    Effect.timeoutOrElse({
      duration: "10 seconds",
      orElse: () =>
        Effect.fail(
          new MigrationError({ cause: new Error("Postgres did not answer within 10 seconds") }),
        ),
    }),
  );

/**
 * The one wait the migrate step and the apps' check share: try again every two seconds
 * for `waitFor`, one log line with the reason per failed attempt, then fail with the last
 * attempt's error. The wait is counted between attempts, so an attempt must bound itself.
 */
const retryFor =
  (waitFor: Duration.Input) =>
  <
    A,
    E extends
      | DatabaseBehindError
      | DatabaseUnreachableError
      | MigrationLockHeldError
      | MigrationError,
    R,
  >(
    attempt: Effect.Effect<A, E, R>,
  ) =>
    attempt.pipe(
      Effect.tapError((error) => {
        switch (error._tag) {
          case "MigrationLockHeldError": {
            return Effect.logWarning(
              "Waiting for the migrate step's lock: another session holds it",
            ).pipe(Effect.annotateLogs({ holder: error.holder }));
          }
          case "DatabaseBehindError": {
            return Effect.logWarning(
              "Waiting for the migrate step: the database is behind this version",
            ).pipe(Effect.annotateLogs({ missing: error.missing.join(", ") }));
          }
          case "DatabaseUnreachableError": {
            // One line an attempt; the cause in full is in the failure, if it comes to that.
            return Effect.logWarning("Waiting for the database: could not reach it").pipe(
              Effect.annotateLogs({ reason: String(error.cause) }),
            );
          }
          default: {
            return Effect.void;
          }
        }
      }),
      Effect.retry({
        schedule: Schedule.spaced("2 seconds").pipe(Schedule.upTo({ duration: waitFor })),
        while: (error) => {
          switch (error._tag) {
            case "DatabaseBehindError":
            case "DatabaseUnreachableError":
            case "MigrationLockHeldError": {
              return true;
            }
            default: {
              return false;
            }
          }
        },
      }),
    );

/**
 * Apply pending Drizzle migrations under a Postgres session advisory lock, so concurrent
 * runs are safe: losers wait, then no-op. No app calls this as it starts; a release runs
 * it once, before its apps (docs/operations/deploys.md).
 *
 * Only the connection is retried, for `waitFor`: a Postgres that is still starting, or
 * restarting, should not fail a release that would have gone through seconds later. Every
 * failure to connect is, a wrong password like a refused connection, as in the apps' check:
 * telling the ones that cannot pass from the ones a starting or reconfigured Postgres gives
 * for a moment is a guess, and the wait is bounded and says why every two seconds. Once
 * connected, nothing is retried: a migration that failed will fail again, and a connection
 * lost part-way has rolled the migrations back, which is for a person to look at.
 *
 * Every wait in it ends. The advisory lock is asked for every two seconds for
 * `lockWaitFor` (five minutes unless given), time enough for another run to finish its
 * migrations, and then the step fails with `MigrationLockHeldError` naming the holder. A
 * table lock, the normalization's or a migration's, is waited for `tableLockWaitFor` (30
 * seconds unless given) and then fails the statement, and with it the step: short, because
 * while the step queues behind a session left idle in a transaction, every accept and SES
 * notification on that table queues behind the step. Nothing limits how long a statement
 * may run once it has its locks: a slow migration is not cut off half-way. A Postgres that
 * goes away without closing the connection is noticed by TCP keepalive.
 *
 * Before the migrations it normalizes stored Contact emails, if that is still to do, and
 * commits that by itself: it stays done when a migration after it fails.
 */
export const migrateDatabase = (options: {
  readonly databaseUrl: string;
  readonly waitFor: Duration.Input;
  readonly lockWaitFor?: Duration.Input;
  readonly tableLockWaitFor?: Duration.Input;
}) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      catch: (cause) => new DatabaseUnreachableError({ cause }),
      try: async () => {
        const client = new Client({
          connectionString: options.databaseUrl,
          options: `-c timezone=${SESSION_TIME_ZONE}`,
          // Says which session is the step's, to whoever reads `pg_stat_activity` or the
          // next run's "Waiting for the migrate step's lock" line.
          application_name: "relayit-migrate",
          // An address that answers nothing would otherwise hold one attempt open. No
          // query timeout for the client: a migration takes as long as it takes.
          connectionTimeoutMillis: 10_000,
          // A peer that is gone without a FIN (its host down, the network cut) never
          // answers and never errors; probes after ten idle seconds end the connection.
          keepAlive: true,
          keepAliveInitialDelayMillis: 10_000,
          // The session's `lock_timeout`: how long any statement waits for a lock, never
          // how long it runs.
          lock_timeout: Duration.toMillis(
            Duration.fromInputUnsafe(options.tableLockWaitFor ?? "30 seconds"),
          ),
        });
        // pg reports a lost connection as an event, and an error event nobody listens for
        // ends the process before the failure is logged. A connection lost between two
        // queries is reported only so: the next query is refused as "not queryable", so the
        // first event is kept as why the step failed.
        const session = { client, lost: undefined as unknown };
        client.on("error", (error) => {
          session.lost ??= error;
        });
        try {
          await client.connect();
          return session;
        } catch (error) {
          await client.end().catch(() => undefined);
          throw error;
        }
      },
    }).pipe(retryFor(options.waitFor)),
    (session) =>
      Effect.gen(function* () {
        const { client } = session;
        // Asked for, not waited for: a wait inside Postgres says nothing while it lasts and
        // ends only with the holder.
        yield* Effect.tryPromise({
          catch: (cause) => new MigrationError({ cause: session.lost ?? cause }),
          try: async () => {
            const lock = await client.query<{ locked: boolean }>(
              "select pg_try_advisory_lock($1, $2) as locked",
              [LOCK_KEY1, LOCK_KEY2],
            );
            if (lock.rows[0]?.locked) {
              return;
            }
            const holder = await client.query<{ holder: string }>(LOCK_HOLDER, [
              LOCK_KEY1,
              LOCK_KEY2,
            ]);
            // None by now: it let go between the two queries, and the next attempt finds out.
            return holder.rows[0]?.holder ?? "a session that has since ended";
          },
        }).pipe(
          answered,
          Effect.flatMap((holder) =>
            holder === undefined
              ? Effect.void
              : Effect.fail(new MigrationLockHeldError({ holder })),
          ),
          retryFor(options.lockWaitFor ?? "5 minutes"),
        );

        const unchecked = yield* Effect.tryPromise({
          catch: (cause) => new MigrationError({ cause: session.lost ?? cause }),
          try: () => client.query<{ unchecked: boolean }>(CONTACT_EMAILS_UNCHECKED),
        }).pipe(answered);
        const contacts = yield* Effect.tryPromise({
          catch: (cause) => new MigrationError({ cause: session.lost ?? cause }),
          try: async () => {
            if (!unchecked.rows[0]?.unchecked) {
              return { merged: 0, normalized: 0 };
            }
            for (const statement of NORMALIZE_CONTACT_EMAILS) {
              await client.query(statement);
            }
            const counted = await client.query<{ merged: number; normalized: number }>(
              `select
                (count(*) filter (where id <> survivor_id))::int as merged,
                (count(*) filter (where id = survivor_id))::int as normalized
              from contact_email_merge`,
            );
            await client.query("commit");
            return counted.rows[0] ?? { merged: 0, normalized: 0 };
          },
        });
        // Said as soon as it is committed: a migration that fails after it does not undo it.
        if (contacts.normalized > 0) {
          yield* Effect.logInfo("Normalized stored Contact emails").pipe(
            Effect.annotateLogs({
              contacts: contacts.normalized,
              mergedIntoThem: contacts.merged,
            }),
          );
        }

        yield* Effect.tryPromise({
          catch: (cause) => new MigrationError({ cause: session.lost ?? cause }),
          try: async () => {
            // An image without its migrations fails here, as a migration that cannot run.
            const result = await migrate(drizzle({ client }), {
              migrationsFolder: resolveMigrationsFolder(),
            });
            if (result != null) {
              throw new Error(`Database migration failed with exit code: ${result.exitCode}`);
            }
          },
        });
      }),
    // Ending the session is what releases the lock. An unlock query of its own would, on a
    // connection that was lost, reject and take the place of the error that says why.
    ({ client }) =>
      Effect.promise(() => client.end().catch(() => undefined)).pipe(
        // `end` waits for Postgres to close its side, which one that has stopped answering
        // never does; the step would then hang after it had already failed.
        Effect.timeoutOption("5 seconds"),
        Effect.andThen(Effect.sync(() => client.connection.stream.destroy())),
      ),
  );

/**
 * What an app does before it serves: succeed once the database has every migration this
 * build carries. Until then it checks every two seconds for `waitFor` (five minutes unless
 * given), then fails with the last check's outcome: `DatabaseBehindError`, or
 * `DatabaseUnreachableError` if it could not ask.
 *
 * Behind is refused because the app's queries would fail one by one. It waits rather than
 * exiting at once because a platform that starts services in no order (Railway) may start
 * this one while the release's migrate step is still running. A database it cannot reach
 * gets the same wait, whatever the reason: Postgres still starting or a dropped connection
 * passes, and exiting costs a restart, of which a platform allows only so many. A database
 * that is ahead, with migrations this build has never heard of, is fine: during a rollout
 * the previous version keeps running against the schema the new one migrated, so a
 * migration must always leave the previous release working.
 */
export const requireMigrated = (options: {
  readonly databaseUrl: string;
  readonly waitFor?: Duration.Input;
}) =>
  Effect.gen(function* () {
    // Drizzle decides what to run by name, so the same comparison says what is missing.
    // Read outside the retry: an image without its migrations will not grow them.
    const carried = yield* Effect.sync(() =>
      readMigrationFiles({ migrationsFolder: resolveMigrationsFolder() }),
    );
    return yield* Effect.tryPromise({
      catch: (cause) => new DatabaseUnreachableError({ cause }),
      try: async () => {
        const client = new Client({
          connectionString: options.databaseUrl,
          options: `-c timezone=${SESSION_TIME_ZONE}`,
          // An address that answers nothing, or a connection that goes quiet after it is
          // made, would otherwise hold one attempt open, and the wait is only counted
          // between attempts.
          connectionTimeoutMillis: 10_000,
          query_timeout: 10_000,
        });
        // pg reports a connection lost between calls as an event, and an error event
        // nobody listens for ends the process.
        client.on("error", () => undefined);
        try {
          await client.connect();
          const applied = await client
            .query<{ name: string | null }>("select name from drizzle.__drizzle_migrations")
            .then(
              (result) => new Set(result.rows.map((row) => row.name)),
              (error: { readonly code?: string }) => {
                // undefined_table: nothing has ever migrated this database.
                if (error.code === "42P01") {
                  return new Set<string | null>();
                }
                throw error;
              },
            );
          return carried.map((migration) => migration.name).filter((name) => !applied.has(name));
        } finally {
          // A client that never connected has nothing to end.
          await client.end().catch(() => undefined);
        }
      },
    }).pipe(
      Effect.flatMap((missing) =>
        missing.length === 0 ? Effect.void : Effect.fail(new DatabaseBehindError({ missing })),
      ),
      retryFor(options.waitFor ?? "5 minutes"),
    );
  });
