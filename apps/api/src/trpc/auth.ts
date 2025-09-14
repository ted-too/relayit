import { db, schema } from "@repo/shared/db";
import type { ClientParsedApiKey } from "@repo/shared/db/types";
import { createApiKeySchema } from "@repo/shared/forms";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authdOrganizationProcedure, authdProcedure, router } from ".";

export const authRouter = router({
  getSession: authdProcedure.query(
    async ({
      ctx: {
        user: _user,
        session: { activeOrganizationId, ..._session },
      },
    }) => {
      const userOrganizations = await db.query.organization.findMany({
        where: (table, { inArray, eq }) =>
          inArray(
            table.id,
            db
              .select({
                id: schema.member.organizationId,
              })
              .from(schema.member)
              .where(eq(schema.member.userId, _user.id))
          ),
      });

      const activeOrganization =
        userOrganizations.find(
          (organization) => organization.id === activeOrganizationId
        ) ?? null;

      // NOTE: This is necessary since the .Infer type from better-auth is not working as expected
      const user = _user as {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };

      const session = _session as {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      };

      return {
        user,
        session: { ...session, activeOrganization },
        userOrganizations,
      };
    }
  ),
  createApiKey: authdOrganizationProcedure
    .input(createApiKeySchema)
    .mutation(async ({ ctx: { user, session, req }, input }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: req.headers,
        body: {
          permissions: {
            apiKey: ["create"],
          },
        },
      });

      if (!hasPermission) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to create API keys",
        });
      }

      const data = await auth.api.createApiKey({
        body: {
          name: input.name,
          rateLimitEnabled: false,
          userId: user.id,
        },
      });

      await db.insert(schema.apikeyOrganization).values({
        apikeyId: data.id,
        organizationId: session.activeOrganization.id,
      });

      return {
        key: data.key,
      };
    }),
  listApiKeys: authdOrganizationProcedure.query(
    async ({ ctx: { session } }) => {
      const apiKeys = await db.query.apikeyOrganization.findMany({
        where: (table, { eq }) =>
          eq(table.organizationId, session.activeOrganization.id),
        with: {
          apikey: {
            columns: {
              key: false,
            },
          },
        },
      });

      return apiKeys.map(
        ({ apikey: key }) => key
      ) satisfies ClientParsedApiKey[];
    }
  ),
  revokeApiKey: authdOrganizationProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx: { session, req }, input }) => {
      const apiKeyLink = await db.query.apikeyOrganization.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.apikeyId, input.id),
            eq(table.organizationId, session.activeOrganization.id)
          ),
      });

      if (!apiKeyLink) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found or not associated with this organization",
        });
      }

      const hasPermission = await auth.api.hasPermission({
        headers: req.headers,
        body: {
          permissions: {
            apiKey: ["revoke"],
          },
        },
      });

      if (!hasPermission) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to revoke API keys",
        });
      }

      await db.delete(schema.apikey).where(eq(schema.apikey.id, input.id));

      return { success: true };
    }),
});
