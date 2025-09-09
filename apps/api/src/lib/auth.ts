import { db, schema } from "@repo/shared/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey, lastLoginMethod, organization } from "better-auth/plugins";
import { redis } from "bun";
import { emailHarmony } from 'better-auth-harmony';

export const auth = betterAuth({
  basePath: "/auth",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
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
    },
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
  },
  plugins: [
    emailHarmony(),
    organization(),
    lastLoginMethod(),
    apiKey({
      disableSessionForAPIKeys: true,
      defaultPrefix: "rel_",
      rateLimit: { enabled: false },
      enableMetadata: true,
    }),
  ],
});
