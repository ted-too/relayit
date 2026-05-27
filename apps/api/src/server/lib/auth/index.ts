import { apiKey } from "@better-auth/api-key";
import { db, schema } from "@repo/api/db";
import { env } from "@repo/api/server/env";
import { BASE_PATH, COOKIE_PREFIX } from "@repo/api/server/lib/auth/constants";
import {
  ac,
  admin,
  member,
  owner,
} from "@repo/api/server/lib/auth/permissions";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { lastLoginMethod, organization } from "better-auth/plugins";
import { emailHarmony } from "better-auth-harmony";
import { RedisClient } from "bun";

const authRedis = new RedisClient(env.REDIS_URL);

function getDomain() {
  const appHostname = new URL(env.APP_URL).hostname.toLowerCase();

  if (!env.DOCS_URL) {
    return appHostname;
  }

  const docsHostname = new URL(env.DOCS_URL).hostname.toLowerCase();

  if (appHostname === docsHostname) {
    return appHostname;
  }

  const appLabels = appHostname.split(".");
  const docsLabels = docsHostname.split(".");
  const sharedLabels: string[] = [];

  let appIndex = appLabels.length - 1;
  let docsIndex = docsLabels.length - 1;

  while (
    appIndex >= 0 &&
    docsIndex >= 0 &&
    appLabels[appIndex] === docsLabels[docsIndex]
  ) {
    sharedLabels.unshift(appLabels[appIndex]);
    appIndex -= 1;
    docsIndex -= 1;
  }

  if (sharedLabels.length >= 2) {
    return `.${sharedLabels.join(".")}`;
  }

  return appHostname;
}

const options = {
  basePath: BASE_PATH,
  baseURL: env.API_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  session: {
    cookieCache: {
      maxAge: 5 * 60,
      refreshCache: false,
    },
  },
  secondaryStorage: {
    get: async (key) => await authRedis.get(key),
    set: async (key, value, ttl) => {
      await authRedis.set(key, value);
      if (ttl) {
        await authRedis.expire(key, ttl);
      }
    },
    delete: async (key) => {
      await authRedis.del(key);
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
      domain: getDomain(),
    },
    database: {
      generateId: false,
    },
    cookiePrefix: COOKIE_PREFIX,
  },
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
  },
  trustedOrigins: [env.APP_URL, ...(env.DOCS_URL ? [env.DOCS_URL] : [])],
  plugins: [
    emailHarmony(),
    organization({
      ac,
      roles: {
        owner,
        admin,
        member,
      },
    }),
    lastLoginMethod(),
    apiKey([
      {
        rateLimit: { enabled: true },
        configId: "user-keys",
        defaultPrefix: "rel_user_",
        references: "user",
        enableMetadata: false,
      },
      {
        rateLimit: { enabled: false },
        configId: "org-keys",
        defaultPrefix: "rel_org_",
        references: "organization",
        enableMetadata: true,
      },
    ]),
  ],
} satisfies BetterAuthOptions;

export const auth = betterAuth({
  ...options,
  plugins: [...(options.plugins ?? [])],
});
