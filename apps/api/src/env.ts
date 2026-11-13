import { objectStorageConfig } from "@repo/object-storage";
import { emailBackendConfig, selectEmailBackend } from "@repo/provider-aws/email/backend";
import { Config, Effect, Option, Redacted } from "effect";

const filled = (group: Record<string, string | Redacted.Redacted<string>>) =>
  Object.values(group).every(
    (value) => (Redacted.isRedacted(value) ? Redacted.value(value) : value) !== "",
  );

/** All six, or billing is off and every Plan limit unlimited. */
const stripeConfig = Config.all({
  priceBroadcastAnnual: Config.String("STRIPE_PRICE_BROADCAST_ANNUAL"),
  priceBroadcastMonthly: Config.String("STRIPE_PRICE_BROADCAST_MONTHLY"),
  priceSignalAnnual: Config.String("STRIPE_PRICE_SIGNAL_ANNUAL"),
  priceSignalMonthly: Config.String("STRIPE_PRICE_SIGNAL_MONTHLY"),
  secretKey: Config.Redacted("STRIPE_SECRET_KEY"),
  webhookSecret: Config.Redacted("STRIPE_WEBHOOK_SECRET"),
}).pipe(Config.option);

export const apiConfig = Effect.gen(function* () {
  const config = yield* Config.all({
    // The dashboard's origin: better-auth's base URL (OAuth callbacks, trusted origin) and
    // the only origin the dashboard's operations accept a change from.
    appUrl: Config.URL("APP_URL"),
    // Parent domain for the session cookie (e.g. `relayit.io`) so the marketing site can
    // tell a visitor is signed in. Unset, the cookie is host-only.
    authCookieDomain: Config.String("AUTH_COOKIE_DOMAIN").pipe(Config.option),
    betterAuthSecrets: Config.Redacted("BETTER_AUTH_SECRETS"),
    // The dashboard's build to serve; the image sets it. Unset, as in development, where
    // Vite serves the dashboard, the api serves only its own routes.
    dashboardDir: Config.String("DASHBOARD_DIR").pipe(Config.option),
    databaseUrl: Config.Redacted("DATABASE_URL"),
    emailBackend: Config.Literals(["ses", "fake"], "EMAIL_BACKEND").pipe(Config.option),
    github: Config.all({
      clientId: Config.String("GITHUB_CLIENT_ID"),
      clientSecret: Config.Redacted("GITHUB_CLIENT_SECRET"),
    }).pipe(Config.option),
    hostname: Config.String("HOST").pipe(Config.withDefault("0.0.0.0")),
    logLevel: Config.LogLevel("LOG_LEVEL").pipe(Config.withDefault("Info")),
    nodeEnv: Config.String("NODE_ENV").pipe(Config.option),
    port: Config.Port("PORT").pipe(Config.withDefault(3005)),
    redisKeyPrefix: Config.String("REDIS_KEY_PREFIX").pipe(Config.withDefault("")),
    redisUrl: Config.Redacted("REDIS_URL"),
    // The deployment's SES account, where Domains are registered; only EMAIL_BACKEND=ses
    // needs them.
    sesAccessKeyId: Config.String("SES_ACCESS_KEY_ID").pipe(Config.option),
    sesRegions: Config.String("SES_REGIONS").pipe(Config.option),
    sesSecretAccessKey: Config.Redacted("SES_SECRET_ACCESS_KEY").pipe(Config.option),
    stripe: stripeConfig,
    // Email Workspaces' Git and builds. Without both, the Template catalog works and the
    // workspace operations answer 503.
    templatingBuilder: Config.all({
      secret: Config.Redacted("TEMPLATING_BUILDER_SECRET"),
      url: Config.String("TEMPLATING_BUILDER_URL"),
    }).pipe(Config.option),
  });
  return {
    ...config,
    // An optional group set to empty strings, as a platform's form leaves it, is unset.
    authCookieDomain: Option.filter(config.authCookieDomain, (domain) => domain !== ""),
    github: Option.filter(config.github, (github) => filled(github)),
    stripe: Option.filter(config.stripe, (stripe) => filled(stripe)),
    templatingBuilder: Option.filter(config.templatingBuilder, (builder) => filled(builder)),
    emailBackend: yield* emailBackendConfig({
      accessKeyId: Option.getOrUndefined(config.sesAccessKeyId),
      kind: yield* selectEmailBackend({
        configured: Option.getOrUndefined(config.emailBackend),
        nodeEnv: Option.getOrUndefined(config.nodeEnv),
      }),
      regions: Option.getOrUndefined(config.sesRegions),
      secretAccessKey: Option.getOrUndefined(
        config.sesSecretAccessKey.pipe(Option.map(Redacted.value)),
      ),
    }),
    objectStorage: yield* objectStorageConfig,
  };
});

export type ApiConfig = Effect.Success<typeof apiConfig>;
