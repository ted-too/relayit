/**
 * `bun run db:seed`: a usable local Project in the root .env's database. A user who can
 * sign in (an admin, so /admin works too), their Project, a verified Domain to send from
 * under the fake email backend, and an API key, printed once. Running it again keeps what
 * is there. Refuses a database or Redis that is not on localhost.
 */
import { createCustomDomain } from "@repo/channels/email/custom-domain/lifecycle";
import { EmailManagedDns } from "@repo/channels/email/managed-dns";
import { verifyCustomDomainRegistration } from "@repo/channels/email/verification/custom-identity";
import { JobsLive } from "@repo/jobs";
import { syncSessionUserLimits } from "@repo/persistence/auth/plans";
import { createAuth } from "@repo/persistence/auth/server";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { createPromiseDb } from "@repo/persistence/db/promise";
import { organization, user } from "@repo/persistence/db/schema";
import { emailBackendConfig, emailBackendLayer } from "@repo/provider-aws/email/backend";
import { makeRedisClient, makeRedisLive } from "@repo/redis";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { developmentEnv, requireLocal } from "./root-env";

const SEED = {
  apiKeyName: "Local seed",
  domain: "local.relayit.test",
  email: "dev@relayit.test",
  name: "Local Developer",
  password: "password",
  projectName: "Local Project",
  projectSlug: "local",
};

const env = developmentEnv();
const databaseUrl = requireLocal("DATABASE_URL", env.DATABASE_URL);
const redisUrl = requireLocal("REDIS_URL", env.REDIS_URL);
const redisKeyPrefix = env.REDIS_KEY_PREFIX ?? "";
if (!env.BETTER_AUTH_SECRETS) {
  throw new Error("BETTER_AUTH_SECRETS is not set: copy .env.example to .env.");
}
const secrets = parseBetterAuthSecrets(env.BETTER_AUTH_SECRETS);

const db = createPromiseDb({ databaseUrl });
const redis = makeRedisClient({ url: redisUrl });
const auth = createAuth({ baseUrl: env.VITE_BASE_URL, db, redis, redisKeyPrefix });

try {
  const existingUser = await db.query.user.findFirst({ where: { email: SEED.email } });
  if (!existingUser) {
    await auth.api.signUpEmail({
      body: { email: SEED.email, name: SEED.name, password: SEED.password },
    });
  }
  const signedIn = await auth.api.signInEmail({
    body: { email: SEED.email, password: SEED.password },
    returnHeaders: true,
  });
  const headers = new Headers({
    cookie: signedIn.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; "),
  });
  const userId = signedIn.response.user.id;
  await db.update(user).set({ role: "admin" }).where(eq(user.id, userId));
  // What the web app's sign-in hook does: no Stripe locally, so no limits.
  await syncSessionUserLimits(db, { stripeConfigured: false, userId });

  const project =
    (await db.query.organization.findFirst({ where: { slug: SEED.projectSlug } })) ??
    (await auth.api.createOrganization({
      body: { name: SEED.projectName, slug: SEED.projectSlug },
      headers,
    }));
  if (!project) {
    throw new Error("Creating the seed Project returned nothing.");
  }
  // The web app's afterCreateOrganization hook sets this; the seed has no web app.
  await db
    .update(organization)
    .set({ billingUserId: userId })
    .where(eq(organization.id, project.id));

  const dbLive = makeDbLive({ databaseUrl });
  const jobsLive = JobsLive.pipe(
    Layer.provide(makeRedisLive({ keyPrefix: redisKeyPrefix, url: redisUrl })),
  );
  // The fake backend, whatever EMAIL_BACKEND says: the seed never reaches AWS or DNS.
  const fake = await Effect.runPromise(
    emailBackendConfig({
      accessKeyId: undefined,
      kind: "fake",
      regions: env.SES_REGIONS,
      secretAccessKey: undefined,
    }),
  );
  const domainLayer = Layer.mergeAll(
    emailBackendLayer(fake),
    EmailManagedDns.noop(),
    SymmetricCrypto.live(secrets),
  ).pipe(Layer.provideMerge(Layer.mergeAll(dbLive, jobsLive)));

  await Effect.runPromise(
    Effect.gen(function* () {
      const effectDb = yield* DB;
      const { customDomainId } = yield* createCustomDomain({
        fqdn: SEED.domain,
        organizationId: project.id,
      });
      const domain = yield* effectDb.query.customDomain.findFirst({
        where: { id: customDomainId },
        with: { registration: true },
      });
      if (domain?.registration) {
        yield* verifyCustomDomainRegistration({
          db: effectDb,
          domain,
          registration: domain.registration,
        });
      }
    }).pipe(Effect.provide(domainLayer)),
  );

  const existingKey = await db.query.apikey.findFirst({
    where: { name: SEED.apiKeyName, referenceId: project.id },
  });
  let apiKeyLine = `API key "${SEED.apiKeyName}" exists already; it was printed when created. bun run worktree:setup --reset starts over.`;
  if (!existingKey) {
    const created = await auth.api.createApiKey({
      body: { configId: "org-keys", name: SEED.apiKeyName, organizationId: project.id },
      headers,
    });
    // As the dashboard does, so its key list shows who made it.
    await auth.api.updateApiKey({
      body: {
        configId: "org-keys",
        keyId: created.id,
        metadata: { createdBy: userId, end: created.key.slice(-6) },
      },
      headers,
    });
    apiKeyLine = `API key (shown once): ${created.key}`;
  }

  console.log(`
Seeded ${new URL(databaseUrl).pathname.slice(1)}.
  Sign in at ${env.VITE_BASE_URL} as ${SEED.email}, password ${SEED.password}
  Project "${SEED.projectName}" (/${SEED.projectSlug}), sending from ${SEED.domain}
  ${apiKeyLine}
  Try it once the apps are up (bun run dev):
    curl -X POST ${env.API_URL}/messages/email -H "x-api-key: <key>" -H "content-type: application/json" \\
      -d '{"from":"hello@${SEED.domain}","to":"bounce@simulator.amazonses.com","subject":"Hi","text":"Hi"}'
`);
} finally {
  redis.close();
  await db.$client.end();
}
