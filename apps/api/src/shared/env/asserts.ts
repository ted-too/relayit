import { env, IS_CLOUD_EDITION } from "./bind";

function assertCloudRequired(
  label: string,
  required: Record<string, string | undefined>
) {
  if (!IS_CLOUD_EDITION) {
    return;
  }

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`EDITION=cloud requires ${label}: ${missing.join(", ")}`);
  }
}

/**
 * Cloud edition requires Stripe credentials. OSS/self-host must not.
 * Call from process entrypoints after env load (api also asserts webhook secret).
 */
export function assertCloudStripeEnv(
  extraRequired: Record<string, string | undefined> = {}
) {
  assertCloudRequired("Stripe env", {
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    STRIPE_PRICE_SIGNAL_MONTHLY: env.STRIPE_PRICE_SIGNAL_MONTHLY,
    STRIPE_PRICE_SIGNAL_ANNUAL: env.STRIPE_PRICE_SIGNAL_ANNUAL,
    STRIPE_PRICE_BROADCAST_MONTHLY: env.STRIPE_PRICE_BROADCAST_MONTHLY,
    STRIPE_PRICE_BROADCAST_ANNUAL: env.STRIPE_PRICE_BROADCAST_ANNUAL,
    ...extraRequired,
  });
}

/** Cloud edition requires Cloudflare for sandbox / inbound DNS. */
export function assertCloudCloudflareEnv() {
  assertCloudRequired("Cloudflare env", {
    CF_ROOT_DOMAIN: env.CF_ROOT_DOMAIN,
    CF_API_TOKEN: env.CF_API_TOKEN,
    CF_ZONE_ID: env.CF_ZONE_ID,
  });
}

/** Cloud edition requires GitHub OAuth for social login. */
export function assertCloudGitHubEnv(values: {
  GITHUB_CLIENT_ID: string | undefined;
  GITHUB_CLIENT_SECRET: string | undefined;
}) {
  assertCloudRequired("GitHub OAuth env", values);
}

/**
 * Runtime guard for Cloudflare DNS ops. Prefer calling only on cloud paths;
 * cloud entrypoints also assert these at startup via `assertCloudCloudflareEnv`.
 */
export function requireCloudflareEnv() {
  const rootDomain = env.CF_ROOT_DOMAIN;
  const apiToken = env.CF_API_TOKEN;
  const zoneId = env.CF_ZONE_ID;

  if (!(rootDomain && apiToken && zoneId)) {
    throw new Error(
      "Cloudflare env (CF_ROOT_DOMAIN, CF_API_TOKEN, CF_ZONE_ID) is required"
    );
  }

  return { rootDomain, apiToken, zoneId };
}
