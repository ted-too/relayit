import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Data, type Duration, Effect, Schedule } from "effect";
import { Client } from "pg";

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

/** The database was reached and the migrations did not apply; the run rolled back whole. */
export class MigrationError extends Data.TaggedError("MigrationError")<{
  readonly cause: unknown;
}> {
  override readonly message = "Could not migrate the database";
}

/**
 * Whether stored Contact emails still have to be normalized: the `contact` table is there
 * and the constraint that keeps them lower-case is not. False on an empty database, where
 * there is nothing to normalize, and for good once the constraint's migration has run.
 */
const CONTACT_EMAILS_UNCHECKED = `
  select to_regclass('contact') is not null and not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('contact') and conname = 'contact_email_lower_check'
  ) as unchecked`;

/**
 * Lower-cases every stored Contact email, which the `contact_email_lower_check` migration
 * then holds the table to. It is data, which a generated migration cannot carry, so the
 * step runs it first, in one transaction of its own.
 *
 * Contacts of one App Environment that then share an address become one. The survivor is the
 * row already lower-case if there is one, since that is the row sends have been finding. It
 * keeps the strictest Suppression any of them had (with that row's reason and time), is
 * unsubscribed if any was, and holds every Topic unsubscribe and Segment membership among
 * them: nothing that stops a send is lost. It is deleted only if all of them were.
 *
 * The table lock keeps writers out, so no Suppression lands on a row between its being read
 * and removed; the previous release's accepts and notifications wait for the commit.
 */
const NORMALIZE_CONTACT_EMAILS = [
  "begin",
  "lock table contact in share row exclusive mode",
  `create temporary table contact_email_merge on commit drop as
    select
      id,
      first_value(id) over (
        partition by organization_app_environment_id, lower(email)
        order by (email = lower(email)) desc, (deleted_at is null) desc, created_at, id
      ) as survivor_id
    from contact
    where (organization_app_environment_id, lower(email)) in (
      select organization_app_environment_id, lower(email) from contact where email <> lower(email)
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
      email = lower(contact.email),
      unsubscribed = merged.unsubscribed,
      suppression_severity = strictest.suppression_severity,
      suppression_reason = strictest.suppression_reason,
      suppressed_at = strictest.suppressed_at,
      deleted_at = merged.deleted_at,
      first_name = merged.first_name,
      last_name = merged.last_name,
      properties = merged.properties,
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
 * The one wait the migrate step and the apps' check share: try again every two seconds
 * for `waitFor`, one log line with the reason per failed attempt, then fail with the last
 * attempt's error. The wait is counted between attempts, so an attempt must bound itself.
 */
const retryFor =
  (waitFor: Duration.Input) =>
  <A, R>(attempt: Effect.Effect<A, DatabaseBehindError | DatabaseUnreachableError, R>) =>
    attempt.pipe(
      Effect.tapError((error) => {
        switch (error._tag) {
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
        }
      }),
      Effect.retry({
        schedule: Schedule.spaced("2 seconds").pipe(Schedule.upTo({ duration: waitFor })),
      }),
    );

/**
 * Apply pending Drizzle migrations under a Postgres session advisory lock, so concurrent
 * runs are safe: losers wait, then no-op. No app calls this as it starts; a release runs
 * it once, before its apps (docs/operations/deploys.md).
 *
 * Only the connection is retried, for `waitFor`: a Postgres that is still starting, or
 * restarting, should not fail a release that would have gone through seconds later. Once
 * connected, nothing is: a migration that failed will fail again, and a connection lost
 * part-way has rolled the run back, which is for a person to look at.
 */
export const migrateDatabase = (options: {
  readonly databaseUrl: string;
  readonly waitFor: Duration.Input;
}) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      catch: (cause) => new DatabaseUnreachableError({ cause }),
      try: async () => {
        const client = new Client({
          connectionString: options.databaseUrl,
          // An address that answers nothing would otherwise hold one attempt open. No
          // query timeout: the lock is waited for and a migration takes as long as it takes.
          connectionTimeoutMillis: 10_000,
        });
        // pg reports a lost connection as an event too, and an error event nobody listens
        // for ends the process before the failure is logged.
        client.on("error", () => undefined);
        try {
          await client.connect();
          return client;
        } catch (error) {
          await client.end().catch(() => undefined);
          throw error;
        }
      },
    }).pipe(retryFor(options.waitFor)),
    (client) =>
      Effect.tryPromise({
        catch: (cause) => new MigrationError({ cause }),
        try: async () => {
          // An image without its migrations fails here, as a migration that cannot run.
          const migrationsFolder = resolveMigrationsFolder();
          await client.query("SELECT pg_advisory_lock($1, $2)", [LOCK_KEY1, LOCK_KEY2]);
          const unchecked = await client.query<{ unchecked: boolean }>(CONTACT_EMAILS_UNCHECKED);
          let contacts = { merged: 0, normalized: 0 };
          if (unchecked.rows[0]?.unchecked) {
            for (const statement of NORMALIZE_CONTACT_EMAILS) {
              await client.query(statement);
            }
            const counted = await client.query<{ merged: number; normalized: number }>(
              `select
                (count(*) filter (where id <> survivor_id))::int as merged,
                (count(*) filter (where id = survivor_id))::int as normalized
              from contact_email_merge`,
            );
            contacts = counted.rows[0] ?? contacts;
            await client.query("commit");
          }
          const result = await migrate(drizzle({ client }), { migrationsFolder });
          if (result != null) {
            throw new Error(`Database migration failed with exit code: ${result.exitCode}`);
          }
          return contacts;
        },
      }).pipe(
        Effect.flatMap((contacts) =>
          contacts.normalized > 0
            ? Effect.logInfo("Normalized stored Contact emails to lower case").pipe(
                Effect.annotateLogs({
                  contacts: contacts.normalized,
                  mergedIntoThem: contacts.merged,
                }),
              )
            : Effect.void,
        ),
      ),
    // Ending the session is what releases the lock. An unlock query of its own would, on a
    // connection that was lost, reject and take the place of the error that says why.
    (client) => Effect.promise(() => client.end().catch(() => undefined)),
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
