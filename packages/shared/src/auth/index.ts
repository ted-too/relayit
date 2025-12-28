import { ac, admin, member, owner } from "@repo/shared/auth/permissions";
import { db, schema } from "@repo/shared/db";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  apiKey,
  customSession,
  lastLoginMethod,
  organization,
} from "better-auth/plugins";
import { emailHarmony } from "better-auth-harmony";
import { redis } from "bun";

declare module "bun" {
  interface Env {
    REDIS_URL: string;
    DATABASE_URL: string;

    APP_URL: string;
    DOCS_URL?: string;

    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
  }
}

const options = {
  basePath: "/auth",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  secondaryStorage: {
    get: async (key) => {
      const value = await redis.get(key);
      return value ? value : null;
    },
    set: async (key, value, ttl) => {
      if (ttl) {
        await redis.set(key, value);
        await redis.expire(key, ttl);
      } else {
        await redis.set(key, value);
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
      domain: `.${new URL(process.env.APP_URL).hostname.split(".").slice(-2).join(".")}`,
    },
    database: {
      generateId: false,
    },
    cookiePrefix: "relayit",
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
  },
  trustedOrigins: [
    process.env.APP_URL,
    ...(process.env.DOCS_URL ? [process.env.DOCS_URL] : []),
  ],
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

export const sharedAuth = betterAuth({
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
