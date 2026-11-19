import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it, test } from "@effect/vitest";
import {
  DeadLetterStoreLive,
  Jobs,
  JobsLive,
  promoteDelayedJobs,
  registerJobHandler,
} from "@repo/jobs";
import { publishOutboxBatch } from "@repo/jobs/outbox";
import { jobOutbox } from "@repo/jobs/outbox-schema";
import { JOB_WORKER_GROUP } from "@repo/jobs/storage";
import { processJobBatch, reclaimStaleJobs } from "@repo/jobs/worker";
import { makeLocalObjectStorageLive, ObjectStorage } from "@repo/object-storage";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  contact,
  customDomain,
  emailDelivery,
  emailDomainRegistration,
  member,
  message,
  organization,
  organizationDomain,
  sandboxDomain,
  user,
  userChannel,
  webhookEndpoint,
  webhookEvent,
} from "@repo/persistence/db/schema";
import { makeRedisLive, Redis } from "@repo/redis";
import { webhookEventDefinitions } from "@repo/webhooks/events";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { Deferred, Duration, Effect, Fiber, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { typeid } from "typeid-js";
import { Usage, UsageLive, UsagePolicyLive } from "../usage";
import { acceptTransactionalEmail } from "./accept";
import type { AcceptTransactionalEmailInput } from "./accept/contracts";
import {
  EmailBackend,
  type EmailBackendError,
  EmailBackendRateLimited,
  EmailBackendRejected,
  type EmailBackendService,
  EmailBackendUnavailable,
} from "./backend";
import { completeDomainClaimTransfer, deleteCustomDomain } from "./custom-domain/lifecycle";
import { emailDeliverJob } from "./delivery/job";
import { endStuckDeliveries, makeEmailDeliverHandler } from "./delivery/handler";
import { MessageDeliveryRetryableError } from "../messages/delivery";
import { SANDBOX_FROM_LOCAL_PART } from "./sender";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;

const unsupported = () => Effect.die("unused");

/**
 * SES, the boundary: records every send and answers with `answer`. `sendsFrom` counts one
 * Project's, since a job another test left in the shared outbox may run here too.
 */
const makeBackend = (
  answer: (
    sender: string,
  ) => Effect.Effect<{ readonly providerMessageId: string }, EmailBackendError> = () => accept,
) => {
  const sends: Parameters<EmailBackendService["send"]>[0][] = [];
  const service = {
    createIdentity: unsupported,
    defaultRegion: "eu-central-1",
    deleteIdentity: unsupported,
    ensureInfrastructure: unsupported,
    getIdentityStatus: unsupported,
    getProjectSendingStatus: unsupported,
    send: (input) =>
      Effect.suspend(() => {
        sends.push(input);
        return answer(input.message.sender.identityFqdn);
      }),
  } satisfies EmailBackendService;
  return {
    layer: Layer.succeed(EmailBackend, service),
    sendsFrom: (fqdn: string) =>
      sends.filter(({ message }) => message.sender.identityFqdn === fqdn),
  };
};

const accept = Effect.sync(() => ({ providerMessageId: `ses-${Bun.randomUUIDv7()}` }));

const services = (
  databaseUrl: string,
  redisUrl: string,
  backend: Layer.Layer<EmailBackend>,
  storage: Layer.Layer<ObjectStorage> = makeLocalObjectStorageLive(
    NodePath.join(NodeOS.tmpdir(), "relayit-send-integration"),
  ),
) =>
  Layer.mergeAll(
    JobsLive,
    UsageLive.pipe(Layer.provide(UsagePolicyLive)),
    DeadLetterStoreLive,
    FetchHttpClient.layer,
    storage,
    backend,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        makeDbLive({ databaseUrl }),
        // Its own prefix, so this run's jobs and Usage never meet another's.
        makeRedisLive({ keyPrefix: `test:${Bun.randomUUIDv7()}:`, url: redisUrl }),
      ),
    ),
  );

const deliverer = registerJobHandler(
  makeEmailDeliverHandler({ apiOrigin: "http://localhost", secret: "test-secret" }),
);

/**
 * One pass of the worker: publish the outbox, promote retries (with the clock a day ahead,
 * so every backoff is due) and run what is ready.
 */
const runWorker = Effect.gen(function* () {
  const redis = yield* Redis;
  yield* redis.createConsumerGroup({ group: JOB_WORKER_GROUP, stream: deliverer.stream });
  yield* publishOutboxBatch({ batchSize: 1000, claimTtlMs: 30_000, concurrency: 1 });
  yield* Effect.gen(function* () {
    yield* TestClock.setTime(Date.now() + 86_400_000);
    yield* promoteDelayedJobs([deliverer], { limit: 100 });
  }).pipe(Effect.provide(TestClock.layer()));
  yield* processJobBatch([deliverer], {
    blockMs: 100,
    concurrency: 1,
    consumer: "test",
    count: 10,
  });
});

/** The reclaim loop of another worker, taking whatever this one still holds. */
const reclaimAll = reclaimStaleJobs([deliverer], {
  concurrency: 1,
  consumer: "test-reclaimer",
  count: 10,
  minIdleMs: 0,
});

/**
 * Postgres failing one Delivery's writes: another session holds its row lock, and `endWaiters`
 * ends every statement left waiting on it, as a dropped connection would.
 */
const makeRowLock = (databaseUrl: string) => {
  const sql = new Bun.SQL(databaseUrl, { max: 2 });
  let holder: Bun.ReservedSQL | undefined;
  let holderPid: number | undefined;
  return {
    endWaiters: Effect.promise(async () => {
      if (holderPid !== undefined) {
        await sql`select pg_terminate_backend(pid) from pg_stat_activity
          where ${holderPid} = any(pg_blocking_pids(pid))`;
      }
    }),
    lock: (deliveryId: string) =>
      Effect.promise(async () => {
        holder = await sql.reserve();
        await holder`begin`;
        await holder`select id from email_delivery where id = ${deliveryId} for update`;
        const [row] = await holder`select pg_backend_pid() as pid`;
        holderPid = (row as { readonly pid: number }).pid;
      }),
    release: Effect.promise(async () => {
      if (holder) {
        await holder`rollback`;
        holder.release();
      }
      await sql.close();
    }),
  };
};

const LATE_COMMIT_MILLIS = 400;

/**
 * Postgres reached through a local proxy that can hold the next COMMIT on the wire, so a
 * test can act while a commit is in flight, or drop the server's answer to it.
 */
const makeCommitGate = (databaseUrl: string) => {
  const target = new URL(databaseUrl);
  let armed: { readonly held: () => void; readonly released: Promise<void> } | undefined;
  let dropArmed = false;
  let lateArmed: { readonly landed: () => void } | undefined;
  const server = Bun.listen<{
    dropAnswer?: boolean;
    late?: boolean;
    pending: Uint8Array[];
    upstream?: Bun.Socket;
  }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      close: (client) => {
        if (!client.data.late) {
          client.data.upstream?.end();
        }
      },
      data: async (client, chunk) => {
        const bytes = Uint8Array.from(chunk);
        const gate = armed;
        const commit = Buffer.from(bytes).includes("COMMIT");
        const late = lateArmed;
        if (late && commit) {
          lateArmed = undefined;
          client.data.late = true;
          client.terminate();
          await Bun.sleep(LATE_COMMIT_MILLIS);
          client.data.upstream?.write(bytes);
          client.data.upstream?.end();
          late.landed();
          return;
        }
        if (gate && commit) {
          armed = undefined;
          gate.held();
          await gate.released;
        }
        if (dropArmed && commit) {
          dropArmed = false;
          client.data.dropAnswer = true;
        }
        if (client.data.upstream) {
          client.data.upstream.write(bytes);
        } else {
          client.data.pending.push(bytes);
        }
      },
      open: (client) => {
        client.data = { pending: [] };
        void Bun.connect({
          hostname: target.hostname,
          port: Number(target.port),
          socket: {
            close: () => {
              client.end();
            },
            data: (_upstream, chunk) => {
              if (client.data.dropAnswer) {
                // The server has committed; the client only sees its connection go.
                client.terminate();
                return;
              }
              client.write(Uint8Array.from(chunk));
            },
            error: () => {
              client.end();
            },
            open: (upstream) => {
              client.data.upstream = upstream;
              for (const bytes of client.data.pending.splice(0)) {
                upstream.write(bytes);
              }
            },
          },
        });
      },
    },
  });
  const url = new URL(databaseUrl);
  url.host = `127.0.0.1:${server.port}`;
  return {
    close: Effect.sync(() => server.stop(true)),
    /**
     * The client's connection goes as it sends its next COMMIT, and the server only gets that
     * COMMIT a moment later: to the client, a failed commit the server is still finishing.
     * `landed` resolves once the server has been sent it.
     */
    commitNextAfterClientIsGone: () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      lateArmed = { landed: resolve };
      return { landed: Effect.promise(() => promise) };
    },
    /** The next COMMIT reaches the server, and its answer never reaches the client. */
    dropNextCommitAnswer: Effect.sync(() => {
      dropArmed = true;
    }),
    /** Holds the next COMMIT until `release`; `held` resolves once it is held. */
    holdNextCommit: () => {
      const { promise: held, resolve: onHeld } = Promise.withResolvers<void>();
      const { promise: released, resolve: release } = Promise.withResolvers<void>();
      armed = { held: onHeld, released };
      return { held: Effect.promise(() => held), release: Effect.sync(() => release()) };
    },
    url: url.toString(),
  };
};

/** Runs `effect` while every statement waiting on `lock` is ended. */
const whileFailing = <A, E, R>(
  lock: ReturnType<typeof makeRowLock>,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const ender = yield* lock.endWaiters.pipe(
      Effect.andThen(Effect.sleep("50 millis")),
      Effect.forever,
      Effect.forkChild,
    );
    const result = yield* effect;
    yield* Fiber.interrupt(ender);
    return result;
  });

/**
 * Object storage whose next download first runs `whileLoading`: what happens to a Delivery's
 * sender while a run is loading its attachments, between reading the Delivery and claiming it.
 */
const makeStorageWithDownloadHook = () => {
  const hook = { whileLoading: Effect.void as Effect.Effect<void> };
  return {
    hook,
    layer: Layer.effect(
      ObjectStorage,
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        return {
          ...storage,
          download: (key) =>
            Effect.suspend(() => hook.whileLoading).pipe(Effect.andThen(storage.download(key))),
        } satisfies typeof storage;
      }),
    ).pipe(
      Layer.provide(
        makeLocalObjectStorageLive(NodePath.join(NodeOS.tmpdir(), "relayit-send-integration")),
      ),
    ),
  };
};

const ATTACHMENT = {
  filename: "notes.txt",
  source: { content: "SGVsbG8=", kind: "base64" as const },
};

const NO_LIMITS = { dailySends: null, monthlySends: null };

/**
 * A Project whose owner pays for it, a verified Domain it sends from, and a Webhook Endpoint
 * taking every event.
 */
const seedProject = (options: { readonly dailySends?: number } = {}) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const userId = typeid("user").toString();
    const organizationId = typeid("orgn").toString();
    const customDomainId = typeid("domn").toString();
    const ownerEmail = `${userId}@members.relayit.test`;
    const fqdn = `${organizationId}.relayit.test`;

    yield* db.insert(user).values({ email: ownerEmail, id: userId, name: "Owner" });
    yield* db.insert(organization).values({
      billingUserId: userId,
      id: organizationId,
      name: "Send integration",
      slug: organizationId.replaceAll("_", "-"),
    });
    yield* db.insert(member).values({ organizationId, role: "owner", userId });
    yield* db.insert(userChannel).values({
      channelType: "email",
      limits: {
        customDomains: null,
        marketing: NO_LIMITS,
        transactional: { dailySends: options.dailySends ?? null, monthlySends: null },
      },
      userId,
    });
    yield* db.insert(customDomain).values({
      dkimPrivateKey: "unused",
      dkimPublicKey: "unused",
      dkimSelector: "relayit",
      fqdn,
      id: customDomainId,
      verificationStatus: "verified",
    });
    yield* db.insert(organizationDomain).values({
      customDomainId,
      organizationId,
      ownershipToken: Bun.randomUUIDv7(),
      ownershipVerificationStatus: "verified",
    });
    yield* db.insert(emailDomainRegistration).values({
      customDomainId,
      region: "eu-central-1",
      verificationStatus: "verified",
    });
    yield* db.insert(webhookEndpoint).values({
      eventTypes: Object.keys(webhookEventDefinitions),
      organizationId,
      signingSecret: "whsec_test",
      url: "https://hooks.relayit.test/events",
    });
    return { customDomainId, fqdn, organizationId, ownerEmail };
  });

const sendInput = (
  project: { readonly organizationId: string },
  from: string,
  to: string,
  attachments: AcceptTransactionalEmailInput["email"]["attachments"] = [],
) =>
  ({
    attribution: { kind: "project" },
    email: {
      attachments,
      bcc: [],
      cc: [],
      content: { kind: "inline", subject: "Hello", text: "Hello" },
      from: { address: from, normalized: from },
      headers: {},
      replyTo: [],
      to: [{ email: to }],
    },
    organizationId: project.organizationId,
  }) satisfies AcceptTransactionalEmailInput;

const deliveryOf = (deliveryId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    return yield* db.query.emailDelivery.findFirst({ where: { id: deliveryId } });
  });

/** The Project's Webhook Events about this Delivery, oldest first. */
const eventsFor = (organizationId: string, deliveryId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const rows = yield* db
      .select({ payload: webhookEvent.payload, type: webhookEvent.type })
      .from(webhookEvent)
      .where(eq(webhookEvent.organizationId, organizationId))
      .orderBy(webhookEvent.createdAt);
    return rows.filter(
      (row) => (row.payload as { readonly delivery_id?: string }).delivery_id === deliveryId,
    );
  });

describe("an accepted email send", () => {
  if (!testDatabaseUrl || !testRedisUrl) {
    process.emitWarning(
      "Skipping send integration tests: TEST_DATABASE_URL and TEST_REDIS_URL are not set",
    );
    // The PostgreSQL and Redis tests are opt-in.
    test.skip("ends sent, skipped or failed, and the Project hears of it", () => undefined);
    return;
  }

  it.live("ends sent with message.sent", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      // One send a day: the sent one keeps its Usage, so the next is refused.
      const project = yield* seedProject({ dailySends: 1 });
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );

      yield* runWorker;

      const delivery = yield* deliveryOf(accepted.deliveryId);
      expect(delivery).toMatchObject({ status: "sent" });
      expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { provider_message_id: delivery?.providerMessageId }, type: "message.sent" },
      ]);
      const refused = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      ).pipe(Effect.flip);
      expect(refused).toMatchObject({ _tag: "UsageLimitExceeded" });
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("is never sent twice when the bookkeeping after SES fails or the job repeats", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const project = yield* seedProject();
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      // Usage can no longer be confirmed, as when Redis loses the reservation.
      const usage = yield* Usage;
      yield* usage.release({ deliveryId: accepted.deliveryId });

      yield* runWorker;
      // A duplicate of the job, as a reclaimed or re-published entry would be.
      const db = yield* DB;
      const jobs = yield* Jobs;
      yield* db.transaction((tx) =>
        jobs.enqueue(
          emailDeliverJob,
          {
            billingUserId: "unused",
            deliveryId: accepted.deliveryId,
            purpose: "transactional",
            startDate: new Date().toISOString(),
          },
          tx,
        ),
      );
      for (let pass = 0; pass < 5; pass += 1) {
        yield* runWorker;
      }

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sent" });
      expect(
        (yield* eventsFor(project.organizationId, accepted.deliveryId)).map(({ type }) => type),
      ).toEqual(["message.sent"]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("ends failed, never sent again, when a worker died while sending it long ago", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const db = yield* DB;
      const project = yield* seedProject();
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      // What a run that claimed it an hour ago and died before SES answered leaves.
      yield* db
        .update(emailDelivery)
        .set({ startedAt: new Date(Date.now() - 3_600_000), status: "sending" })
        .where(eq(emailDelivery.id, accepted.deliveryId));

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "failed" });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { type: "message.failed" },
      ]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("ends failed, with one message.failed, when left sending with no job to end it", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const db = yield* DB;
      // One send a day, so Usage still held would refuse the next.
      const project = yield* seedProject({ dailySends: 1 });
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      // What a run that claimed it two days ago leaves when its job is then lost: SES never
      // answered, and nothing is queued to come back for it.
      yield* db.delete(jobOutbox).where(like(jobOutbox.payload, `%${accepted.deliveryId}%`));
      yield* db
        .update(emailDelivery)
        .set({ startedAt: new Date(Date.now() - 2 * 86_400_000), status: "sending" })
        .where(eq(emailDelivery.id, accepted.deliveryId));
      yield* runWorker;
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sending" });

      // Two workers reconcile at once, and one again later.
      yield* Effect.all([endStuckDeliveries, endStuckDeliveries], { concurrency: 2 });
      yield* endStuckDeliveries;

      const reason = "The send was interrupted and its outcome is unknown; it is not sent again";
      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        completedAt: expect.any(Date),
        error: { message: reason, retryable: false },
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { error: reason }, type: "message.failed" },
      ]);
      const next = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      expect(next.replayed).toBe(false);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("is told failed once when its job turns up after the worker ended it", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const db = yield* DB;
      // One send a day, so Usage still held would refuse the next.
      const project = yield* seedProject({ dailySends: 1 });
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      // Claimed two days ago, and its job held up all that time rather than lost.
      yield* db
        .update(emailDelivery)
        .set({ startedAt: new Date(Date.now() - 2 * 86_400_000), status: "sending" })
        .where(eq(emailDelivery.id, accepted.deliveryId));

      yield* endStuckDeliveries;
      yield* runWorker;
      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "failed" });
      expect(
        (yield* eventsFor(project.organizationId, accepted.deliveryId)).map(({ type }) => type),
      ).toEqual(["message.failed"]);
      const next = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      expect(next.replayed).toBe(false);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("ends failed as refused when SES refused it and it was never put back", () => {
    const lock = makeRowLock(testDatabaseUrl);
    let ours = "";
    let deliveryId = "";
    // SES refuses, and from then on Postgres refuses this Delivery's writes, the requeue too.
    const backend = makeBackend((sender) =>
      sender === ours
        ? lock
            .lock(deliveryId)
            .pipe(
              Effect.andThen(Effect.fail(new EmailBackendRateLimited({ region: "eu-central-1" }))),
            )
        : accept,
    );
    return Effect.gen(function* () {
      const project = yield* seedProject();
      ours = project.fqdn;
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      deliveryId = accepted.deliveryId;
      yield* whileFailing(lock, runWorker);
      yield* lock.release;
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sending" });

      // Its job never runs again; the reconcile finds it two days later.
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(Date.now() + 2 * 86_400_000);
        yield* endStuckDeliveries;
      }).pipe(Effect.provide(TestClock.layer()));

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        error: { message: "SES send failed" },
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { error: "SES send failed" }, type: "message.failed" },
      ]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("is left to its job while it has been sending for less than a day", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const db = yield* DB;
      const project = yield* seedProject();
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      // Long past its lease, but a job held up by a backlog or an outage may still come.
      yield* db
        .update(emailDelivery)
        .set({ startedAt: new Date(Date.now() - 23 * 3_600_000), status: "sending" })
        .where(eq(emailDelivery.id, accepted.deliveryId));

      yield* endStuckDeliveries;

      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sending" });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toEqual([]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("ends sent, not failed, when SES took it and only the record was left sending", () => {
    const lock = makeRowLock(testDatabaseUrl);
    let ours = "";
    let deliveryId = "";
    // SES accepts, and from then on Postgres refuses this Delivery's writes.
    const backend = makeBackend((sender) =>
      sender === ours ? lock.lock(deliveryId).pipe(Effect.andThen(accept)) : accept,
    );
    return Effect.gen(function* () {
      const project = yield* seedProject({ dailySends: 1 });
      ours = project.fqdn;
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      deliveryId = accepted.deliveryId;
      yield* whileFailing(lock, runWorker);
      yield* lock.release;
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sending" });

      // Its job never runs again; the reconcile finds it two days later.
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(Date.now() + 2 * 86_400_000);
        yield* endStuckDeliveries;
      }).pipe(Effect.provide(TestClock.layer()));

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
      const delivery = yield* deliveryOf(accepted.deliveryId);
      expect(delivery).toMatchObject({
        providerMessageId: expect.stringMatching(/^ses-/),
        status: "sent",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { provider_message_id: delivery?.providerMessageId }, type: "message.sent" },
      ]);
      // A sent Delivery keeps its Usage.
      const refused = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      ).pipe(Effect.flip);
      expect(refused).toMatchObject({ _tag: "UsageLimitExceeded" });
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("ends sent once when a reclaimed duplicate runs while SES is still answering", () =>
    Effect.gen(function* () {
      const sendStarted = yield* Deferred.make<void>();
      const answer = yield* Deferred.make<void>();
      let ours = "";
      const backend = makeBackend((sender) =>
        sender === ours
          ? Deferred.succeed(sendStarted, undefined).pipe(
              Effect.andThen(Deferred.await(answer)),
              Effect.andThen(accept),
            )
          : accept,
      );
      yield* Effect.gen(function* () {
        const project = yield* seedProject();
        ours = project.fqdn;
        const accepted = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
        );

        const first = yield* runWorker.pipe(Effect.forkChild);
        yield* Deferred.await(sendStarted);
        // Another worker reclaims the entry the first still holds and runs it alongside.
        yield* reclaimAll;
        yield* Deferred.succeed(answer, undefined);
        yield* Fiber.join(first);
        // The duplicate's retry, which finds what the first run did.
        yield* runWorker;

        expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sent" });
        expect(
          (yield* eventsFor(project.organizationId, accepted.deliveryId)).map(({ type }) => type),
        ).toEqual(["message.sent"]);
      }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
    }),
  );

  it.live("leaves a send SES never answers claimed until its lease runs out, then fails it", () =>
    Effect.gen(function* () {
      const sendStarted = yield* Deferred.make<void>();
      let ours = "";
      const backend = makeBackend((sender) =>
        sender === ours
          ? Deferred.succeed(sendStarted, undefined).pipe(Effect.andThen(Effect.never))
          : accept,
      );
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(Date.now());
        const project = yield* seedProject();
        ours = project.fqdn;
        const accepted = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
        );

        const pass = yield* runWorker.pipe(Effect.forkChild);
        yield* Deferred.await(sendStarted);
        yield* TestClock.withLive(Effect.sleep("50 millis"));
        yield* TestClock.adjust(Duration.seconds(31));
        yield* Fiber.join(pass);
        // SES may have taken it, so it is neither requeued nor failed yet.
        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sending" });

        // Its retry, inside the lease, leaves the claim to the run that made it.
        yield* runWorker;
        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sending" });

        yield* TestClock.adjust(Duration.minutes(2));
        yield* runWorker;

        expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "failed" });
        expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
          { type: "message.failed" },
        ]);
      }).pipe(
        Effect.provide(
          Layer.merge(services(testDatabaseUrl, testRedisUrl, backend.layer), TestClock.layer()),
        ),
      );
    }),
  );

  it.live("ends sent when Postgres fails right after SES accepts and then comes back", () => {
    const lock = makeRowLock(testDatabaseUrl);
    let ours = "";
    let deliveryId = "";
    // SES accepts, and from then on Postgres refuses this Delivery's writes.
    const backend = makeBackend((sender) =>
      sender === ours ? lock.lock(deliveryId).pipe(Effect.andThen(accept)) : accept,
    );
    return Effect.gen(function* () {
      const project = yield* seedProject();
      ours = project.fqdn;
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      deliveryId = accepted.deliveryId;

      yield* whileFailing(lock, runWorker);
      yield* lock.release;
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sending" });

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
      const delivery = yield* deliveryOf(accepted.deliveryId);
      expect(delivery).toMatchObject({
        providerMessageId: expect.stringMatching(/^ses-/),
        status: "sent",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { provider_message_id: delivery?.providerMessageId }, type: "message.sent" },
      ]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("ends failed once Postgres takes the outcome of a Domain paused after accept", () => {
    const lock = makeRowLock(testDatabaseUrl);
    const backend = makeBackend();
    return Effect.gen(function* () {
      const db = yield* DB;
      const project = yield* seedProject();
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      yield* db
        .update(customDomain)
        .set({ isPaused: true, pausedReason: "manual_admin_pause" })
        .where(eq(customDomain.id, project.customDomainId));

      yield* lock.lock(accepted.deliveryId);
      yield* whileFailing(lock, runWorker);
      yield* lock.release;
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "queued" });

      // The job stayed pending, so the reclaim loop runs it again.
      yield* reclaimAll;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        error: { message: "Domain is paused" },
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { error: "Domain is paused" }, type: "message.failed" },
      ]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("a run SES refuses never overwrites an outcome written while it waited", () =>
    Effect.gen(function* () {
      const sendStarted = yield* Deferred.make<void>();
      const answer = yield* Deferred.make<void>();
      let ours = "";
      const backend = makeBackend((sender) =>
        sender === ours
          ? Deferred.succeed(sendStarted, undefined).pipe(
              Effect.andThen(Deferred.await(answer)),
              Effect.andThen(Effect.fail(new EmailBackendUnavailable({ region: "eu-central-1" }))),
            )
          : accept,
      );
      yield* Effect.gen(function* () {
        const db = yield* DB;
        const project = yield* seedProject();
        ours = project.fqdn;
        const accepted = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
        );

        const pass = yield* runWorker.pipe(Effect.forkChild);
        yield* Deferred.await(sendStarted);
        // Another run settled it meanwhile.
        yield* db
          .update(emailDelivery)
          .set({ status: "failed" })
          .where(eq(emailDelivery.id, accepted.deliveryId));
        yield* Deferred.succeed(answer, undefined);
        yield* Fiber.join(pass);

        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "failed" });
      }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
    }),
  );

  describe("refused by SES while Postgres refused the Delivery's writes", () => {
    /**
     * A send SES refused as `reason` whose outcome could not be written, the requeue
     * included: left `sending`, with only SES's kept answer to say what happened.
     */
    const leftSending = (reason: "message_rejected" | "project_sending_paused") => {
      const lock = makeRowLock(testDatabaseUrl);
      const sent = { deliveryId: "", fqdn: "" };
      const backend = makeBackend((sender) =>
        sender === sent.fqdn
          ? lock
              .lock(sent.deliveryId)
              .pipe(
                Effect.andThen(
                  Effect.fail(new EmailBackendRejected({ reason, region: "eu-central-1" })),
                ),
              )
          : accept,
      );
      const refused = Effect.gen(function* () {
        const project = yield* seedProject();
        sent.fqdn = project.fqdn;
        const accepted = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
        );
        sent.deliveryId = accepted.deliveryId;
        // The job's own dead-letter step fails with the rest while the writes are refused.
        yield* whileFailing(lock, Effect.exit(runWorker));
        yield* lock.release;
        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sending" });
        return { ...project, deliveryId: accepted.deliveryId };
      });
      return { backend, refused };
    };

    const handler = makeEmailDeliverHandler({ apiOrigin: "http://localhost", secret: "test" });
    /** What ends the Delivery afterwards, once Postgres takes writes again. */
    const enders = {
      "its job's next run": () =>
        Effect.gen(function* () {
          for (let pass = 0; pass < 3; pass += 1) {
            yield* runWorker;
          }
        }),
      "its job's dead-letter step": (deliveryId: string) =>
        handler.onDeadLetter?.(
          {
            billingUserId: "unused",
            deliveryId,
            purpose: "transactional",
            startDate: new Date().toISOString(),
          },
          { attempt: emailDeliverJob.retry.maxAttempts, enqueuedAt: Date.now(), id: "last" },
          new MessageDeliveryRetryableError({
            deliveryId,
            message: "Unexpected delivery failure",
            stage: "runtime",
          }),
        ) ?? Effect.die("the delivery job has no dead-letter step"),
      // Its job never runs again; the reconcile finds it two days later.
      "the worker, two days later": () =>
        Effect.gen(function* () {
          yield* TestClock.setTime(Date.now() + 2 * 86_400_000);
          yield* endStuckDeliveries;
        }).pipe(Effect.provide(TestClock.layer())),
    };

    it.live.each([
      "its job's next run",
      "its job's dead-letter step",
      "the worker, two days later",
    ] as const)(
      "for a Project Sending Pause, ends failed for the pause and pauses the Domain when ended by %s",
      (ender) => {
        const { backend, refused } = leftSending("project_sending_paused");
        return Effect.gen(function* () {
          const db = yield* DB;
          const project = yield* refused;

          yield* enders[ender](project.deliveryId);

          // From the answer SES already gave: it is not asked again.
          expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
          expect(yield* deliveryOf(project.deliveryId)).toMatchObject({
            error: { message: "SES paused sending for this Project" },
            status: "failed",
          });
          const domain = yield* db.query.customDomain.findFirst({
            where: { id: project.customDomainId },
          });
          // The pause the api lifts again once SES reports the Project's sending restored.
          expect(domain).toMatchObject({ isPaused: true, pausedReason: "project_sending_pause" });
          expect(yield* eventsFor(project.organizationId, project.deliveryId)).toMatchObject([
            { payload: { error: "SES paused sending for this Project" }, type: "message.failed" },
          ]);
          // Told of the Domain once, though the failure was written on a later run.
          const domainEvents = yield* db
            .select({ payload: webhookEvent.payload })
            .from(webhookEvent)
            .where(
              and(
                eq(webhookEvent.organizationId, project.organizationId),
                eq(webhookEvent.type, "domain.updated"),
              ),
            );
          expect(domainEvents).toEqual([
            {
              payload: {
                domain_id: project.customDomainId,
                paused: true,
                paused_reason: "project_sending_pause",
                status: "verified",
              },
            },
          ]);
        }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
      },
    );

    it.live.each(["its job's dead-letter step", "the worker, two days later"] as const)(
      "for the message itself, ends failed as rejected when ended by %s",
      (ender) => {
        const { backend, refused } = leftSending("message_rejected");
        return Effect.gen(function* () {
          const project = yield* refused;

          yield* enders[ender](project.deliveryId);

          expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
          expect(yield* deliveryOf(project.deliveryId)).toMatchObject({
            error: { message: "SES rejected the message" },
            status: "failed",
          });
          expect(yield* eventsFor(project.organizationId, project.deliveryId)).toMatchObject([
            { payload: { error: "SES rejected the message" }, type: "message.failed" },
          ]);
        }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
      },
    );
  });

  it.live("an SES error after it may have taken the send ends failed, never sent again", () => {
    let ours = "";
    // SES takes the send, and the connection drops before its answer arrives.
    const backend = makeBackend((sender) =>
      sender === ours
        ? Effect.fail(new EmailBackendUnavailable({ region: "eu-central-1" }))
        : accept,
    );
    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.now());
      const project = yield* seedProject();
      ours = project.fqdn;
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );

      yield* runWorker;
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sending" });
      // Within the claim's lease the retry leaves it alone.
      yield* runWorker;
      yield* TestClock.adjust(Duration.minutes(3));
      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "failed" });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { type: "message.failed" },
      ]);
    }).pipe(
      Effect.provide(
        Layer.merge(services(testDatabaseUrl, testRedisUrl, backend.layer), TestClock.layer()),
      ),
    );
  });

  it.live("ends failed, never sent again, when the run sending it died of a defect", () => {
    let ours = "";
    // A bug somewhere under the send: the run dies holding its claim, SES's answer unknown.
    const backend = makeBackend((sender) =>
      sender === ours ? Effect.die(new TypeError("undefined is not a function")) : accept,
    );
    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.now());
      const project = yield* seedProject();
      ours = project.fqdn;
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );

      // The worker's pass survives it, and the job has its retries.
      yield* runWorker;
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sending" });
      yield* TestClock.adjust(Duration.minutes(3));
      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "failed" });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { type: "message.failed" },
      ]);
    }).pipe(
      Effect.provide(
        Layer.merge(services(testDatabaseUrl, testRedisUrl, backend.layer), TestClock.layer()),
      ),
    );
  });

  it.live("a send SES refused is sent again and delivered", () => {
    let ours = "";
    let refusals = 0;
    const backend = makeBackend((sender) => {
      if (sender !== ours || refusals > 0) {
        return accept;
      }
      refusals += 1;
      return Effect.fail(new EmailBackendRateLimited({ region: "eu-central-1" }));
    });
    return Effect.gen(function* () {
      const project = yield* seedProject();
      ours = project.fqdn;
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );

      yield* runWorker;
      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(2);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sent" });
      expect(
        (yield* eventsFor(project.organizationId, accepted.deliveryId)).map(({ type }) => type),
      ).toEqual(["message.sent"]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("a run that lost the claim on its last attempt leaves the Delivery to the winner", () =>
    Effect.gen(function* () {
      const sendStarted = yield* Deferred.make<void>();
      const answer = yield* Deferred.make<void>();
      let ours = "";
      let calls = 0;
      // The winner's first send is refused once it has been held; its retry delivers.
      const backend = makeBackend((sender) => {
        if (sender !== ours) {
          return accept;
        }
        calls += 1;
        return calls === 1
          ? Deferred.succeed(sendStarted, undefined).pipe(
              Effect.andThen(Deferred.await(answer)),
              Effect.andThen(Effect.fail(new EmailBackendRateLimited({ region: "eu-central-1" }))),
            )
          : accept;
      });
      const handler = makeEmailDeliverHandler({ apiOrigin: "http://localhost", secret: "test" });
      yield* Effect.gen(function* () {
        const project = yield* seedProject();
        ours = project.fqdn;
        const accepted = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
        );
        const payload = {
          billingUserId: "unused",
          deliveryId: accepted.deliveryId,
          purpose: "transactional" as const,
          startDate: new Date().toISOString(),
        };

        const winner = yield* runWorker.pipe(Effect.forkChild);
        yield* Deferred.await(sendStarted);
        // A duplicate run on its last attempt finds the claim taken...
        const lost = yield* handler
          .handle(payload, { attempt: 5, enqueuedAt: Date.now(), id: "duplicate" })
          .pipe(Effect.flip);
        expect(lost).toBeInstanceOf(MessageDeliveryRetryableError);
        // ...SES refuses the winner, which puts it back for its retry...
        yield* Deferred.succeed(answer, undefined);
        yield* Fiber.join(winner);
        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "queued" });
        // ...and the duplicate's dead-letter step, run as the worker would, leaves it there.
        const onDeadLetter = handler.onDeadLetter;
        expect(onDeadLetter).toBeDefined();
        yield* (
          onDeadLetter?.(payload, { attempt: 5, enqueuedAt: Date.now(), id: "duplicate" }, lost) ??
          Effect.void
        );
        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "queued" });

        yield* runWorker;

        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "sent" });
        expect(
          (yield* eventsFor(project.organizationId, accepted.deliveryId)).map(({ type }) => type),
        ).toEqual(["message.sent"]);
      }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
    }),
  );

  it.live(
    "an interrupt while the accept commits leaves the send accepted, counted and whole",
    () => {
      const gate = makeCommitGate(testDatabaseUrl);
      const uploaded: string[] = [];
      const deleted: string[] = [];
      // Object storage, the boundary.
      const storage = Layer.succeed(ObjectStorage, {
        delete: (key) => Effect.sync(() => void deleted.push(key)),
        download: unsupported,
        exists: unsupported,
        signedDownloadUrl: unsupported,
        signedUploadUrl: unsupported,
        upload: (key) => Effect.sync(() => (uploaded.push(key), { key })),
      });
      return Effect.gen(function* () {
        const db = yield* DB;
        // One send a day, so a released reservation would let the next through.
        const project = yield* seedProject({ dailySends: 1 });
        const committing = gate.holdNextCommit();
        const accepting = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, "someone@example.com", [
            { filename: "notes.txt", source: { content: "SGVsbG8=", kind: "base64" } },
          ]),
        ).pipe(Effect.forkChild);
        yield* committing.held;
        const interrupting = yield* Fiber.interrupt(accepting).pipe(Effect.forkChild);
        yield* Effect.sleep("50 millis");
        yield* committing.release;
        yield* Fiber.join(interrupting);

        const [delivery] = yield* db
          .select({ status: emailDelivery.status })
          .from(emailDelivery)
          .where(eq(emailDelivery.customDomainId, project.customDomainId));
        expect(delivery).toMatchObject({ status: "queued" });
        expect(uploaded).toHaveLength(1);
        expect(deleted).toEqual([]);
        const refused = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
        ).pipe(Effect.flip);
        expect(refused).toMatchObject({ _tag: "UsageLimitExceeded" });
      }).pipe(
        Effect.provide(services(gate.url, testRedisUrl, makeBackend().layer, storage)),
        Effect.ensuring(gate.close),
      );
    },
  );

  it.live("a COMMIT the server took but whose answer was lost keeps the send whole", () => {
    const gate = makeCommitGate(testDatabaseUrl);
    const uploaded: string[] = [];
    const deleted: string[] = [];
    // Object storage, the boundary.
    const storage = Layer.succeed(ObjectStorage, {
      delete: (key) => Effect.sync(() => void deleted.push(key)),
      download: unsupported,
      exists: unsupported,
      signedDownloadUrl: unsupported,
      signedUploadUrl: unsupported,
      upload: (key) => Effect.sync(() => (uploaded.push(key), { key })),
    });
    return Effect.gen(function* () {
      const db = yield* DB;
      // One send a day, so a released reservation would let the next through.
      const project = yield* seedProject({ dailySends: 1 });
      yield* gate.dropNextCommitAnswer;
      const exit = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com", [
          { filename: "notes.txt", source: { content: "SGVsbG8=", kind: "base64" } },
        ]),
      ).pipe(Effect.exit);
      // The client saw the COMMIT fail...
      expect(exit._tag).toBe("Failure");

      // ...but it committed, so nothing of the send is given back.
      const [delivery] = yield* db
        .select({ status: emailDelivery.status })
        .from(emailDelivery)
        .where(eq(emailDelivery.customDomainId, project.customDomainId));
      expect(delivery).toMatchObject({ status: "queued" });
      expect(uploaded).toHaveLength(1);
      expect(deleted).toEqual([]);
      const refused = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      ).pipe(Effect.flip);
      expect(refused).toMatchObject({ _tag: "UsageLimitExceeded" });
    }).pipe(
      Effect.provide(services(gate.url, testRedisUrl, makeBackend().layer, storage)),
      Effect.ensuring(gate.close),
    );
  });

  it.live(
    "a COMMIT that fails for the client and lands a moment later keeps the send whole",
    () => {
      const gate = makeCommitGate(testDatabaseUrl);
      const uploaded: string[] = [];
      const deleted: string[] = [];
      // Object storage, the boundary.
      const storage = Layer.succeed(ObjectStorage, {
        delete: (key) => Effect.sync(() => void deleted.push(key)),
        download: unsupported,
        exists: unsupported,
        signedDownloadUrl: unsupported,
        signedUploadUrl: unsupported,
        upload: (key) => Effect.sync(() => (uploaded.push(key), { key })),
      });
      return Effect.gen(function* () {
        const db = yield* DB;
        // One send a day, so a released reservation would let the next through.
        const project = yield* seedProject({ dailySends: 1 });
        const commit = gate.commitNextAfterClientIsGone();
        const exit = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, "someone@example.com", [ATTACHMENT]),
        ).pipe(Effect.exit);
        // The client saw the COMMIT fail before the server had finished it...
        expect(exit._tag).toBe("Failure");
        yield* commit.landed;

        // ...and waited to learn it committed, so nothing of the send is given back.
        const [delivery] = yield* db
          .select({ status: emailDelivery.status })
          .from(emailDelivery)
          .where(eq(emailDelivery.customDomainId, project.customDomainId));
        expect(delivery).toMatchObject({ status: "queued" });
        expect(uploaded).toHaveLength(1);
        expect(deleted).toEqual([]);
        const refused = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
        ).pipe(Effect.flip);
        expect(refused).toMatchObject({ _tag: "UsageLimitExceeded" });
      }).pipe(
        Effect.provide(services(gate.url, testRedisUrl, makeBackend().layer, storage)),
        Effect.ensuring(gate.close),
      );
    },
  );

  it.live("gives back the Usage of a failed Delivery when its job runs again", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const db = yield* DB;
      // One send a day, so Usage still held would refuse the next.
      const project = yield* seedProject({ dailySends: 1 });
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      // What a dead-letter step leaves when it wrote the outcome but Redis refused the
      // release: the job stays pending and runs again.
      yield* db
        .update(emailDelivery)
        .set({ completedAt: new Date(), status: "failed" })
        .where(eq(emailDelivery.id, accepted.deliveryId));

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      const next = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      expect(next.replayed).toBe(false);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("ends skipped with delivery.skipped when its Contact is suppressed after accept", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const db = yield* DB;
      // One send a day, so the skipped send's Usage must be given back for the next.
      const project = yield* seedProject({ dailySends: 1 });
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "Bounced@Example.com"),
      );
      const [suppressed] = yield* db
        .update(contact)
        .set({
          suppressedAt: new Date(),
          suppressionReason: "hard_bounce",
          suppressionSeverity: "all",
        })
        .where(eq(contact.email, "bounced@example.com"))
        .returning({ id: contact.id });
      expect(suppressed).toBeDefined();

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "skipped" });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { reason: "suppression" }, type: "delivery.skipped" },
      ]);
      yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("ends failed with message.failed when its Domain is paused after accept", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const db = yield* DB;
      const project = yield* seedProject();
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      yield* db
        .update(customDomain)
        .set({ isPaused: true, pausedReason: "manual_admin_pause" })
        .where(eq(customDomain.id, project.customDomainId));

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        error: { message: "Domain is paused" },
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { error: "Domain is paused" }, type: "message.failed" },
      ]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("ends failed, unsent, when its Project loses the Domain after accept", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const db = yield* DB;
      // One send a day, so the failed send's Usage must be given back for the next.
      const project = yield* seedProject({ dailySends: 1 });
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      // Another Project's claim proven, or this Project removing the Domain, ends its link.
      const [link] = yield* db
        .delete(organizationDomain)
        .where(eq(organizationDomain.customDomainId, project.customDomainId))
        .returning();

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        error: { message: "The Project no longer holds the sending Domain" },
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        {
          payload: { error: "The Project no longer holds the sending Domain" },
          type: "message.failed",
        },
      ]);
      // Given the Domain back, the Project can send again: the failed send's Usage was freed.
      if (link) {
        yield* db.insert(organizationDomain).values(link);
      }
      yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  /** Another Project adds the FQDN a removed Domain had: a new Domain, verified and sending. */
  const addedByAnotherProject = (fqdn: string) =>
    Effect.gen(function* () {
      const db = yield* DB;
      const other = yield* seedProject();
      yield* db.update(customDomain).set({ fqdn }).where(eq(customDomain.id, other.customDomainId));
      return other;
    });

  it.live("ends failed, unsent, when its Domain is removed after accept", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const project = yield* seedProject({ dailySends: 1 });
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      yield* deleteCustomDomain(project);
      // The FQDN sending again, for another Project, sends nothing of the removed Domain's.
      const other = yield* addedByAnotherProject(project.fqdn);

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        customDomainId: null,
        error: { message: "The Project no longer holds the sending Domain" },
        from: { address: `hello@${project.fqdn}` },
        removedDomainFqdn: project.fqdn,
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        {
          payload: { error: "The Project no longer holds the sending Domain" },
          type: "message.failed",
        },
      ]);
      expect(yield* eventsFor(other.organizationId, accepted.deliveryId)).toEqual([]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("is not sent when its Domain is removed while the run was loading attachments", () => {
    const backend = makeBackend();
    const storage = makeStorageWithDownloadHook();
    return Effect.gen(function* () {
      const context = yield* Effect.context<DB | Jobs>();
      const project = yield* seedProject();
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com", [ATTACHMENT]),
      );
      // The run has read the Delivery with its Domain, registered and sending; by the time
      // it claims, the Domain is gone and the same FQDN is another Project's.
      storage.hook.whileLoading = deleteCustomDomain(project).pipe(
        Effect.andThen(addedByAnotherProject(project.fqdn)),
        Effect.provide(context),
        Effect.orDie,
      );

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        customDomainId: null,
        error: { message: "The Project no longer holds the sending Domain" },
        removedDomainFqdn: project.fqdn,
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        {
          payload: { error: "The Project no longer holds the sending Domain" },
          type: "message.failed",
        },
      ]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer, storage.layer)));
  });

  /** Another session's transaction holding a Domain's row, as a removal or transfer does. */
  const holdDomainRow = (customDomainId: string) =>
    Effect.promise(async () => {
      const sql = new Bun.SQL(testDatabaseUrl, { max: 1 });
      const session = await sql.reserve();
      await session`begin`;
      await session`select id from custom_domain where id = ${customDomainId} for update`;
      const [backend] = await session`select pg_backend_pid() as pid`;
      const { pid } = backend as { readonly pid: number };
      return {
        session,
        // Until another backend is waiting on a lock this session holds, asked of Postgres
        // from a session of its own, so what follows always finds the other side waiting.
        blocksAnother: async () => {
          const watch = new Bun.SQL(testDatabaseUrl, { max: 1 });
          try {
            for (let tries = 0; tries < 400; tries += 1) {
              const waiting = await watch`select 1 from pg_stat_activity
                where wait_event_type = 'Lock' and ${pid} = any(pg_blocking_pids(pid))`;
              if (waiting.length > 0) {
                return;
              }
              await Bun.sleep(25);
            }
            throw new Error("No backend came to wait on the Domain's row");
          } finally {
            await watch.close();
          }
        },
        end: async () => {
          await session`commit`;
          session.release();
          await sql.close();
        },
      };
    });

  it.live("refuses a send whose Project loses the Domain as it is accepted", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const db = yield* DB;
      const project = yield* seedProject({ dailySends: 1 });
      // The Domain is being taken from the Project while the accept, which has already
      // resolved its sender, goes on to write the Delivery.
      const taking = yield* holdDomainRow(project.customDomainId);
      const accepting = yield* Effect.forkChild(
        Effect.result(
          acceptTransactionalEmail(
            sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
          ),
        ),
      );
      const [link] = yield* Effect.promise(async () => {
        await taking.blocksAnother();
        const links = await taking.session`delete from organization_domain
          where custom_domain_id = ${project.customDomainId} returning ownership_token`;
        await taking.end();
        return links as { readonly ownership_token: string }[];
      });

      expect(yield* Fiber.join(accepting)).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "EmailAcceptRejected", code: "invalid_from_address" },
      });
      // No Delivery was written naming a Domain the Project no longer holds.
      expect(
        yield* db
          .select({ id: emailDelivery.id })
          .from(emailDelivery)
          .where(eq(emailDelivery.customDomainId, project.customDomainId)),
      ).toEqual([]);
      // Given the Domain back, the one send a day is still the Project's to make.
      yield* db.insert(organizationDomain).values({
        customDomainId: project.customDomainId,
        organizationId: project.organizationId,
        ownershipToken: link?.ownership_token ?? Bun.randomUUIDv7(),
        ownershipVerificationStatus: "verified",
      });
      yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("a Project Sending Pause never pauses a Domain another Project has taken", () => {
    let ours = "";
    let transfer: Effect.Effect<unknown> = Effect.void;
    const backend = makeBackend((sender) =>
      sender === ours
        ? // The other Project's claim is proven while SES is answering this send.
          Effect.suspend(() => transfer).pipe(
            Effect.andThen(
              Effect.fail(
                new EmailBackendRejected({
                  reason: "project_sending_paused",
                  region: "eu-central-1",
                }),
              ),
            ),
          )
        : accept,
    );
    return Effect.gen(function* () {
      const db = yield* DB;
      const project = yield* seedProject();
      const other = yield* seedProject();
      ours = project.fqdn;
      yield* db.insert(organizationDomain).values({
        customDomainId: project.customDomainId,
        organizationId: other.organizationId,
        ownershipToken: Bun.randomUUIDv7(),
      });
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
      transfer = completeDomainClaimTransfer({
        customDomainId: project.customDomainId,
        db,
        organizationId: other.organizationId,
        proof: {},
      }).pipe(Effect.orDie, Effect.provide(yield* Effect.context<EmailBackend | Jobs>()));

      yield* runWorker;

      // The send fails for its own Project, and the Domain, now the other's, sends on.
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        customDomainId: null,
        error: { message: "SES paused sending for this Project" },
        removedDomainFqdn: project.fqdn,
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { error: "SES paused sending for this Project" }, type: "message.failed" },
      ]);
      expect(
        yield* db.query.customDomain.findFirst({
          columns: { isPaused: true, pausedReason: true },
          where: { id: project.customDomainId },
        }),
      ).toEqual({ isPaused: false, pausedReason: null });
      expect(
        yield* db.query.organizationDomain.findMany({
          columns: { organizationId: true, ownershipVerificationStatus: true },
          where: { customDomainId: project.customDomainId },
        }),
      ).toEqual([
        { organizationId: other.organizationId, ownershipVerificationStatus: "verified" },
      ]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("two sends of one Project refused for its pause at once both end failed", () => {
    // SES pauses a Project and refuses everything of its in flight, each send from a Domain
    // of its own: both answers arrive together, once both sends have been claimed.
    let ours: readonly string[] = [];
    let inFlight = 0;
    let bothInFlight: (() => void) | undefined;
    const together = new Promise<void>((resolve) => {
      bothInFlight = resolve;
    });
    const backend = makeBackend((sender) => {
      if (!ours.includes(sender)) {
        return accept;
      }
      inFlight += 1;
      if (inFlight === 2) {
        bothInFlight?.();
      }
      return Effect.promise(() => together).pipe(
        Effect.andThen(
          Effect.fail(
            new EmailBackendRejected({ reason: "project_sending_paused", region: "eu-central-1" }),
          ),
        ),
      );
    });
    return Effect.gen(function* () {
      const db = yield* DB;
      const redis = yield* Redis;
      const project = yield* seedProject();
      const secondId = typeid("domn").toString();
      const second = `${secondId}.relayit.test`;
      yield* db.insert(customDomain).values({
        dkimPrivateKey: "unused",
        dkimPublicKey: "unused",
        dkimSelector: "relayit",
        fqdn: second,
        id: secondId,
        verificationStatus: "verified",
      });
      yield* db.insert(organizationDomain).values({
        customDomainId: secondId,
        organizationId: project.organizationId,
        ownershipToken: Bun.randomUUIDv7(),
        ownershipVerificationStatus: "verified",
      });
      yield* db.insert(emailDomainRegistration).values({
        customDomainId: secondId,
        region: "eu-central-1",
        verificationStatus: "verified",
      });
      ours = [project.fqdn, second];
      const accepted = yield* Effect.forEach(ours, (fqdn) =>
        acceptTransactionalEmail(sendInput(project, `hello@${fqdn}`, "someone@example.com")),
      );

      // One pass of a worker running both at once.
      yield* redis.createConsumerGroup({ group: JOB_WORKER_GROUP, stream: deliverer.stream });
      yield* publishOutboxBatch({ batchSize: 1000, claimTtlMs: 30_000, concurrency: 1 });
      yield* processJobBatch([deliverer], {
        blockMs: 100,
        concurrency: 2,
        consumer: "test",
        count: 10,
      });

      // Neither run was ended as a deadlock and left for a retry.
      for (const { deliveryId } of accepted) {
        expect(yield* deliveryOf(deliveryId)).toMatchObject({
          error: { message: "SES paused sending for this Project" },
          status: "failed",
        });
        expect(yield* eventsFor(project.organizationId, deliveryId)).toMatchObject([
          { payload: { error: "SES paused sending for this Project" }, type: "message.failed" },
        ]);
      }
      for (const id of [project.customDomainId, secondId]) {
        expect(
          yield* db.query.customDomain.findFirst({
            columns: { isPaused: true, pausedReason: true },
            where: { id },
          }),
        ).toEqual({ isPaused: true, pausedReason: "project_sending_pause" });
      }
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("a Project Sending Pause and a removal of its Domain never deadlock", () => {
    let ours = "";
    let project: Effect.Success<ReturnType<typeof seedProject>> | undefined;
    let removal: Promise<void> | undefined;
    const backend = makeBackend((sender) =>
      sender === ours && project
        ? // A removal takes the Domain's row while SES is answering, then goes on to the
          // Domain's Deliveries, this one among them, while the pause is being written.
          holdDomainRow(project.customDomainId).pipe(
            Effect.tap((removing) =>
              Effect.sync(() => {
                const { customDomainId, fqdn } = project ?? { customDomainId: "", fqdn: "" };
                removal = (async () => {
                  await removing.blocksAnother();
                  await removing.session`delete from organization_domain
                    where custom_domain_id = ${customDomainId}`;
                  await removing.session`update email_delivery
                    set custom_domain_id = null, removed_domain_fqdn = ${fqdn}
                    where custom_domain_id = ${customDomainId}`;
                  await removing.end();
                })();
                // Reported where it is awaited, below.
                removal.catch(() => undefined);
              }),
            ),
            Effect.andThen(
              Effect.fail(
                new EmailBackendRejected({
                  reason: "project_sending_paused",
                  region: "eu-central-1",
                }),
              ),
            ),
          )
        : accept,
    );
    return Effect.gen(function* () {
      const db = yield* DB;
      project = yield* seedProject();
      ours = project.fqdn;
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );

      yield* runWorker;

      // Neither was ended by Postgres as a deadlock: the removal finished, and the one run
      // failed the Delivery and told the Project.
      yield* Effect.promise(() => removal ?? Promise.reject(new Error("no removal ran")));
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        customDomainId: null,
        error: { message: "SES paused sending for this Project" },
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { error: "SES paused sending for this Project" }, type: "message.failed" },
      ]);
      // The Project no longer holds it, so it is not paused for the Project's reputation.
      expect(
        yield* db.query.customDomain.findFirst({
          columns: { isPaused: true },
          where: { id: project.customDomainId },
        }),
      ).toEqual({ isPaused: false });
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live(
    "a send SES refuses for a Project Sending Pause pauses the Project's Domains in the region, whatever it was sent from",
    () => {
      const paused = new EmailBackendRejected({
        reason: "project_sending_paused",
        region: "eu-central-1",
      });
      let refusedFrom = "";
      const backend = makeBackend((sender) =>
        sender === refusedFrom ? Effect.fail(paused) : accept,
      );
      return Effect.gen(function* () {
        const db = yield* DB;
        const project = yield* seedProject();
        const other = yield* seedProject();
        // A second Domain of the Project's in the region, and one registered in another.
        const held = (region: string) =>
          Effect.gen(function* () {
            const customDomainId = typeid("domn").toString();
            yield* db.insert(customDomain).values({
              dkimPrivateKey: "unused",
              dkimPublicKey: "unused",
              dkimSelector: "relayit",
              fqdn: `${customDomainId}.relayit.test`,
              id: customDomainId,
              verificationStatus: "verified",
            });
            yield* db.insert(organizationDomain).values({
              customDomainId,
              organizationId: project.organizationId,
              ownershipToken: Bun.randomUUIDv7(),
              ownershipVerificationStatus: "verified",
            });
            yield* db
              .insert(emailDomainRegistration)
              .values({ customDomainId, region, verificationStatus: "verified" });
            return customDomainId;
          });
        const second = yield* held("eu-central-1");
        const elsewhere = yield* held("us-east-1");
        // The send goes out from the Sandbox Domain, which other Projects share.
        const sandboxDomainId = typeid("sbxd").toString();
        const rootDomain = `${sandboxDomainId}.sandbox.relayit.test`;
        yield* db.insert(sandboxDomain).values({
          cloudflareZoneId: "unused",
          dkimPrivateKey: "unused",
          dkimPublicKey: "unused",
          dkimSelector: "relayit",
          id: sandboxDomainId,
          isActive: true,
          rootDomain,
          verificationStatus: "verified",
        });
        yield* db.insert(emailDomainRegistration).values({
          region: "eu-central-1",
          sandboxDomainId,
          verificationStatus: "verified",
        });
        yield* db
          .update(organization)
          .set({ sandboxDomainId })
          .where(eq(organization.id, project.organizationId));
        refusedFrom = rootDomain;
        const accepted = yield* acceptTransactionalEmail(
          sendInput(project, `${SANDBOX_FROM_LOCAL_PART}@${rootDomain}`, project.ownerEmail),
        );

        yield* runWorker;

        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
          error: { message: "SES paused sending for this Project" },
          status: "failed",
        });
        const pauseOf = (id: string) =>
          db.query.customDomain.findFirst({
            columns: { isPaused: true, pausedReason: true },
            where: { id },
          });
        for (const id of [project.customDomainId, second]) {
          expect(yield* pauseOf(id)).toEqual({
            isPaused: true,
            pausedReason: "project_sending_pause",
          });
        }
        expect(yield* pauseOf(elsewhere)).toEqual({ isPaused: false, pausedReason: null });
        expect(yield* pauseOf(other.customDomainId)).toEqual({
          isPaused: false,
          pausedReason: null,
        });
        // The Sandbox Domain is every Project's: one Project's pause must not close it.
        expect(
          yield* db.query.sandboxDomain.findFirst({
            columns: { isPaused: true, pausedReason: true },
            where: { id: sandboxDomainId },
          }),
        ).toEqual({ isPaused: false, pausedReason: null });
      }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
    },
  );

  it.live("ends failed when its Sandbox Domain is paused after accept", () => {
    const backend = makeBackend();
    return Effect.gen(function* () {
      const db = yield* DB;
      const project = yield* seedProject();
      const sandboxDomainId = typeid("sbxd").toString();
      const rootDomain = `${sandboxDomainId}.sandbox.relayit.test`;
      yield* db.insert(sandboxDomain).values({
        cloudflareZoneId: "unused",
        dkimPrivateKey: "unused",
        dkimPublicKey: "unused",
        dkimSelector: "relayit",
        id: sandboxDomainId,
        isActive: true,
        rootDomain,
        verificationStatus: "verified",
      });
      yield* db.insert(emailDomainRegistration).values({
        region: "eu-central-1",
        sandboxDomainId,
        verificationStatus: "verified",
      });
      yield* db
        .update(organization)
        .set({ sandboxDomainId })
        .where(eq(organization.id, project.organizationId));
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `${SANDBOX_FROM_LOCAL_PART}@${rootDomain}`, project.ownerEmail),
      );
      yield* db
        .update(sandboxDomain)
        .set({ isPaused: true })
        .where(eq(sandboxDomain.id, sandboxDomainId));

      yield* runWorker;

      expect(backend.sendsFrom(rootDomain)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        error: { message: "Sandbox Domain is paused or inactive" },
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { error: "Sandbox Domain is paused or inactive" }, type: "message.failed" },
      ]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("is not sent from a Domain paused while the run was loading its attachments", () => {
    const backend = makeBackend();
    const storage = makeStorageWithDownloadHook();
    return Effect.gen(function* () {
      const db = yield* DB;
      const project = yield* seedProject();
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com", [ATTACHMENT]),
      );
      // The run has read the Delivery and found its Domain sending; the pause lands before
      // it claims.
      storage.hook.whileLoading = db
        .update(customDomain)
        .set({ isPaused: true, pausedReason: "manual_admin_pause" })
        .where(eq(customDomain.id, project.customDomainId))
        .pipe(Effect.orDie);

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        error: { message: "Domain is paused" },
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { error: "Domain is paused" }, type: "message.failed" },
      ]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer, storage.layer)));
  });

  it.live("is not sent on a Domain its Project lost while the run was loading attachments", () => {
    const backend = makeBackend();
    const storage = makeStorageWithDownloadHook();
    return Effect.gen(function* () {
      const db = yield* DB;
      const project = yield* seedProject();
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com", [ATTACHMENT]),
      );
      // Another Project proves its claim after the run has read the Delivery.
      storage.hook.whileLoading = db
        .delete(organizationDomain)
        .where(eq(organizationDomain.customDomainId, project.customDomainId))
        .pipe(Effect.orDie);

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        error: { message: "The Project no longer holds the sending Domain" },
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        {
          payload: { error: "The Project no longer holds the sending Domain" },
          type: "message.failed",
        },
      ]);
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer, storage.layer)));
  });

  it.live("is not sent to a Contact suppressed while the run was loading its attachments", () => {
    const backend = makeBackend();
    const storage = makeStorageWithDownloadHook();
    return Effect.gen(function* () {
      const db = yield* DB;
      // One send a day, so the skipped send's Usage must be given back for the next.
      const project = yield* seedProject({ dailySends: 1 });
      const bounced = `bounced-${project.organizationId}@example.com`;
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, bounced, [ATTACHMENT]),
      );
      // The run has read the Delivery and found its recipient unsuppressed; the bounce lands
      // before it claims.
      storage.hook.whileLoading = db
        .update(contact)
        .set({
          suppressedAt: new Date(),
          suppressionReason: "hard_bounce",
          suppressionSeverity: "all",
        })
        .where(eq(contact.email, bounced))
        .pipe(Effect.orDie);

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        error: { details: { reason: "suppression" } },
        status: "skipped",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { reason: "suppression" }, type: "delivery.skipped" },
      ]);
      yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer, storage.layer)));
  });

  it.live(
    "goes only to the recipients left when others are suppressed while its attachments load",
    () => {
      const backend = makeBackend();
      const storage = makeStorageWithDownloadHook();
      return Effect.gen(function* () {
        const db = yield* DB;
        const project = yield* seedProject();
        const address = (name: string) => `${name}-${project.organizationId}@example.com`;
        const input = sendInput(project, `hello@${project.fqdn}`, address("kept"), [ATTACHMENT]);
        const accepted = yield* acceptTransactionalEmail({
          ...input,
          email: {
            ...input.email,
            bcc: [{ email: address("bcc") }],
            cc: [{ email: address("cc") }],
            // Stored as the Project wrote it; a Contact's address is lower-case.
            to: [
              { email: address("kept") },
              { email: address("To").replace("example", "Example") },
            ],
          },
        });
        // One recipient of each kind is suppressed after the run stripped none.
        storage.hook.whileLoading = db
          .update(contact)
          .set({
            suppressedAt: new Date(),
            suppressionReason: "hard_bounce",
            suppressionSeverity: "all",
          })
          .where(inArray(contact.email, [address("to"), address("cc"), address("bcc")]))
          .pipe(Effect.orDie);

        yield* runWorker;

        expect(
          backend.sendsFrom(project.fqdn).map(({ message }) => ({
            bcc: message.bcc,
            cc: message.cc,
            to: message.to,
          })),
        ).toEqual([{ bcc: null, cc: null, to: [address("kept")] }]);
        // The Delivery names who it went to, as one whose recipient was stripped at accept does.
        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
          bcc: [],
          cc: [],
          status: "sent",
          to: [address("kept")],
        });
        expect(
          (yield* eventsFor(project.organizationId, accepted.deliveryId)).map(({ type }) => type),
        ).toEqual(["message.sent"]);
      }).pipe(
        Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer, storage.layer)),
      );
    },
  );

  it.live(
    "is sent when the Suppression that refused its claim is lifted before the run reads why",
    () => {
      const backend = makeBackend();
      const storage = makeStorageWithDownloadHook();
      return Effect.gen(function* () {
        const db = yield* DB;
        const project = yield* seedProject();
        const restored = `restored-${project.organizationId}@example.com`;
        const accepted = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, restored, [ATTACHMENT]),
        );
        // Postgres lifts the Suppression right after any statement that updates Deliveries, the
        // refused claim included (a statement trigger fires though no row matched): between the
        // claim and the read that asks why it matched nothing.
        const lift = `lift_${project.organizationId}`;
        yield* db.execute(
          sql.raw(`create function ${lift}() returns trigger language plpgsql as $$ begin
          update contact set suppression_severity = null, suppression_reason = null,
            suppressed_at = null where email = '${restored}' and suppression_severity is not null;
          return null; end $$`),
        );
        yield* db.execute(
          sql.raw(`create trigger ${lift} after update on email_delivery
          for each statement execute function ${lift}()`),
        );
        storage.hook.whileLoading = db
          .update(contact)
          .set({
            suppressedAt: new Date(),
            suppressionReason: "manual",
            suppressionSeverity: "all",
          })
          .where(eq(contact.email, restored))
          .pipe(Effect.orDie);

        yield* runWorker.pipe(
          Effect.ensuring(
            db.execute(sql.raw(`drop function ${lift}() cascade`)).pipe(Effect.orDie),
          ),
        );

        // No run holds the Delivery and nothing stops it any more, so it is not left `queued`.
        expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
        expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
          status: "sent",
          to: [restored],
        });
        expect(
          (yield* eventsFor(project.organizationId, accepted.deliveryId)).map(({ type }) => type),
        ).toEqual(["message.sent"]);
      }).pipe(
        Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer, storage.layer)),
      );
    },
  );

  it.live(
    "a complaint landing while attachments load stops a marketing send, not a transactional one",
    () => {
      const backend = makeBackend();
      const storage = makeStorageWithDownloadHook();
      // No marketing send is accepted yet, so the Message is made a Campaign's. Its job still
      // says transactional: the Message's purpose, not the job's, decides who is suppressed.
      const handler = makeEmailDeliverHandler({ apiOrigin: "http://localhost", secret: "test" });
      return Effect.gen(function* () {
        const db = yield* DB;
        const project = yield* seedProject();
        const reader = `reader-${project.organizationId}@example.com`;
        const marketing = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, reader, [ATTACHMENT]),
        );
        yield* db
          .update(message)
          .set({ purpose: "marketing" })
          .where(eq(message.id, marketing.messageId));
        const complain = db
          .update(contact)
          .set({
            suppressedAt: new Date(),
            suppressionReason: "complaint",
            suppressionSeverity: "marketing",
          })
          .where(eq(contact.email, reader))
          .pipe(Effect.orDie);

        storage.hook.whileLoading = complain;
        yield* handler
          .handle(
            {
              billingUserId: "unused",
              deliveryId: marketing.deliveryId,
              purpose: "transactional",
              startDate: new Date().toISOString(),
            },
            { attempt: 1, enqueuedAt: Date.now(), id: "marketing" },
          )
          .pipe(Effect.flip);

        expect(backend.sendsFrom(project.fqdn)).toHaveLength(0);
        expect(yield* deliveryOf(marketing.deliveryId)).toMatchObject({ status: "skipped" });
        expect(yield* eventsFor(project.organizationId, marketing.deliveryId)).toMatchObject([
          { payload: { reason: "suppression" }, type: "delivery.skipped" },
        ]);

        // The same complaint, landing in the same place, leaves a transactional send alone.
        yield* db
          .update(contact)
          .set({ suppressedAt: null, suppressionReason: null, suppressionSeverity: null })
          .where(eq(contact.email, reader));
        const transactional = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, reader, [ATTACHMENT]),
        );
        storage.hook.whileLoading = complain;

        yield* runWorker;

        expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
        expect(yield* deliveryOf(transactional.deliveryId)).toMatchObject({ status: "sent" });
      }).pipe(
        Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer, storage.layer)),
      );
    },
  );

  it.live("ends failed on the first attempt when SES rejects the message itself", () => {
    const backend = makeBackend(() =>
      Effect.fail(new EmailBackendRejected({ reason: "message_rejected", region: "eu-central-1" })),
    );
    return Effect.gen(function* () {
      // One send a day, so the failed send's Usage must be given back for the next.
      const project = yield* seedProject({ dailySends: 1 });
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );

      yield* runWorker;

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        error: { message: "SES rejected the message", retryable: false },
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { error: "SES rejected the message" }, type: "message.failed" },
      ]);
      // Nothing is left to send it again.
      yield* runWorker;
      expect(backend.sendsFrom(project.fqdn)).toHaveLength(1);
      yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("ends failed with message.failed once SES has refused every retry", () => {
    const backend = makeBackend(() =>
      Effect.fail(new EmailBackendRateLimited({ region: "eu-central-1" })),
    );
    return Effect.gen(function* () {
      // One send a day, so the failed send's Usage must be given back for the next.
      const project = yield* seedProject({ dailySends: 1 });
      const accepted = yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );

      yield* runWorker;
      // SES did not take it, so it waits for its retry as it was accepted.
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({ status: "queued" });
      for (let pass = 1; pass < emailDeliverJob.retry.maxAttempts; pass += 1) {
        yield* runWorker;
      }

      expect(backend.sendsFrom(project.fqdn)).toHaveLength(emailDeliverJob.retry.maxAttempts);
      expect(yield* deliveryOf(accepted.deliveryId)).toMatchObject({
        error: { message: "SES send failed" },
        status: "failed",
      });
      expect(yield* eventsFor(project.organizationId, accepted.deliveryId)).toMatchObject([
        { payload: { error: "SES send failed" }, type: "message.failed" },
      ]);
      yield* acceptTransactionalEmail(
        sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
      );
    }).pipe(Effect.provide(services(testDatabaseUrl, testRedisUrl, backend.layer)));
  });

  it.live("gives back Usage and staged attachments when the client disconnects mid-accept", () => {
    const uploaded: string[] = [];
    const deleted: string[] = [];
    return Effect.gen(function* () {
      const secondUpload = yield* Deferred.make<void>();
      // Object storage, the boundary: the second upload never finishes.
      const storage = Layer.succeed(ObjectStorage, {
        delete: (key) => Effect.sync(() => void deleted.push(key)),
        download: unsupported,
        exists: unsupported,
        signedDownloadUrl: unsupported,
        signedUploadUrl: unsupported,
        upload: (key) =>
          Effect.suspend(() => {
            uploaded.push(key);
            return uploaded.length === 1
              ? Effect.succeed({ key })
              : Deferred.succeed(secondUpload, undefined).pipe(Effect.andThen(Effect.never));
          }),
      });

      yield* Effect.gen(function* () {
        // One send a day, so a leaked reservation would refuse the next.
        const project = yield* seedProject({ dailySends: 1 });
        const attachment = {
          filename: "notes.txt",
          source: { content: "SGVsbG8=", kind: "base64" as const },
        };
        const accepting = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, "someone@example.com", [
            attachment,
            attachment,
          ]),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(secondUpload);
        yield* Fiber.interrupt(accepting);

        // The second, cut off mid-flight, may have landed all the same: it is deleted too.
        expect(uploaded).toHaveLength(2);
        expect(deleted.toSorted()).toEqual(uploaded.toSorted());
        const next = yield* acceptTransactionalEmail(
          sendInput(project, `hello@${project.fqdn}`, "someone@example.com"),
        );
        expect(next.replayed).toBe(false);
      }).pipe(
        Effect.provide(services(testDatabaseUrl, testRedisUrl, makeBackend().layer, storage)),
      );
    });
  });
});
