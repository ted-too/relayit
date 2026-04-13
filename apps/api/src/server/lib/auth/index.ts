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
import {
  customSession,
  lastLoginMethod,
  organization,
} from "better-auth/plugins";
import { emailHarmony } from "better-auth-harmony";
import { redis } from "bun";

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
    get: async (key) => await redis.get(key),
    set: async (key, value, ttl) => {
      await redis.set(key, value);
      if (ttl) {
        await redis.expire(key, ttl);
      }
    },
    delete: async (key) => {
      await redis.del(key);
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
    apiKey({
      enableSessionForAPIKeys: false,
      defaultPrefix: "rel_",
      rateLimit: { enabled: false },
      enableMetadata: true,
    }),
  ],
} satisfies BetterAuthOptions;

export const auth = betterAuth({
  ...options,
  plugins: [
    ...(options.plugins ?? []),
    customSession(
      async ({ user, session: { activeOrganizationId, ...session } }) => {
        const organizations = (
          await db.query.member.findMany({
            where: (member, { eq }) => eq(member.userId, user.id),
            with: {
              organization: {
                columns: {
                  id: true,
                  slug: true,
                  name: true,
                  logo: true,
                },
              },
            },
          })
        ).map((member) => member.organization);

        const activeOrganization = activeOrganizationId
          ? organizations.find(
              (organization) => organization.id === activeOrganizationId
            )
          : undefined;

        return {
          user: {
            ...user,
            organizations,
          },
          session: {
            ...session,
            activeOrganization: activeOrganization
              ? {
                  id: activeOrganization.id,
                  slug: activeOrganization.slug,
                  name: activeOrganization.name,
                  logo: activeOrganization.logo,
                }
              : undefined,
          },
        };
      },
      options
    ),
  ],
});
