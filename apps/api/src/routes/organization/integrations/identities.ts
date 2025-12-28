import { auth } from "@repo/api/lib/auth";
import { activeOrganization, betterAuth } from "@repo/api/lib/auth-handler";
import { handleIdentityDefaultFlag } from "@repo/api/routes/organization/integrations/utils";
import { db, schema } from "@repo/shared/db";
import type { ProviderIdentity } from "@repo/shared/db/types";
import { createIdentitySchema, updateIdentitySchema } from "@repo/shared/forms";
import { count, eq } from "drizzle-orm";
import { Elysia, status } from "elysia";
import z from "zod";

export const identitiesRoutes = new Elysia({ prefix: "/identities" })
  .use(betterAuth)
  .use(activeOrganization)
  .guard({
    activeOrganization: true,
    auth: true,
    params: z.object({
      slug: z.string(), // organization slug
      id: z.string(), // provider credential id
    }),
  })
  .get("/", async ({ params, organization }) => {
    const providerCredential = await db.query.providerCredential.findFirst({
      where: (table, { eq, and }) =>
        and(eq(table.id, params.id), eq(table.organizationId, organization.id)),
    });

    if (!providerCredential) {
      return status(404, "Provider credential not found");
    }

    const identities = await db.query.providerIdentity.findMany({
      where: (table, { eq }) => eq(table.providerCredentialId, params.id),
      orderBy: (table, { desc, asc }) => [
        desc(table.isDefault),
        asc(table.createdAt),
      ],
    });

    return identities satisfies ProviderIdentity[];
  })
  .post(
    "/",
    async ({ body, params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          permissions: {
            integration: ["create"],
          },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to create identities");
      }

      const providerCredential = await db.query.providerCredential.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.id, params.id),
            eq(table.organizationId, organization.id)
          ),
      });

      if (!providerCredential) {
        return status(
          404,
          "Provider credential not found or not associated with this organization"
        );
      }

      const existingIdentity = await db.query.providerIdentity.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.providerCredentialId, params.id),
            eq(table.identifier, body.identifier)
          ),
      });

      if (existingIdentity) {
        return status(
          400,
          "An identity with this identifier already exists for this provider"
        );
      }

      const [{ count: existingIdentitiesCount }] = await db
        .select({ count: count() })
        .from(schema.providerIdentity)
        .where(eq(schema.providerIdentity.providerCredentialId, params.id));

      const isFirstIdentityForProvider = existingIdentitiesCount === 0;

      const [newIdentity] = await db.transaction(async (tx) => {
        const shouldBeDefault = await handleIdentityDefaultFlag(tx, {
          providerCredentialId: params.id,
          isDefault: body.isDefault,
          isFirstIdentityForProvider,
        });

        return tx
          .insert(schema.providerIdentity)
          .values({
            providerCredentialId: params.id,
            identifier: body.identifier,
            channelData: body.channelData || {},
            isDefault: shouldBeDefault,
            isActive: body.isActive,
          })
          .returning();
      });

      return newIdentity satisfies ProviderIdentity;
    },
    {
      body: createIdentitySchema,
    }
  )
  .group(
    "/byId/:identityId",
    {
      params: z.object({
        identityId: z.string(),
      }),
    },
    (app) =>
      app
        .patch(
          "/",
          async ({ params, organization, request, body }) => {
            const hasPermission = await auth.api.hasPermission({
              headers: request.headers,
              body: {
                permissions: {
                  integration: ["update"],
                },
              },
            });

            if (!hasPermission) {
              return status(
                403,
                "You do not have permission to update identities"
              );
            }

            const existingIdentity = await db.query.providerIdentity.findFirst({
              where: (table, { eq }) => eq(table.id, params.identityId),
              with: {
                providerCredential: true,
              },
            });

            if (
              !existingIdentity ||
              existingIdentity.providerCredential.organizationId !==
                organization.id
            ) {
              return status(
                404,
                "Identity not found or not associated with this organization"
              );
            }

            // If updating identifier, check for conflicts
            if (
              body.identifier &&
              body.identifier !== existingIdentity.identifier
            ) {
              const newIdentifier = body.identifier; // TypeScript guard
              const conflictingIdentity =
                await db.query.providerIdentity.findFirst({
                  where: (table, { eq, and, ne }) =>
                    and(
                      eq(
                        table.providerCredentialId,
                        existingIdentity.providerCredentialId
                      ),
                      eq(table.identifier, newIdentifier),
                      ne(table.id, params.identityId)
                    ),
                });

              if (conflictingIdentity) {
                return status(
                  400,
                  "An identity with this identifier already exists for this provider"
                );
              }

              const [updatedIdentity] = await db.transaction(async (tx) => {
                if (body.isDefault !== undefined) {
                  await handleIdentityDefaultFlag(tx, {
                    providerCredentialId: existingIdentity.providerCredentialId,
                    isDefault: body.isDefault,
                    isFirstIdentityForProvider: false,
                  });
                }

                // Update the identity
                return tx
                  .update(schema.providerIdentity)
                  .set({
                    identifier: body.identifier,
                    channelData: body.channelData || {},
                    isDefault: body.isDefault,
                    isActive: body.isActive,
                  })
                  .where(eq(schema.providerIdentity.id, params.identityId))
                  .returning();
              });

              return updatedIdentity satisfies ProviderIdentity;
            }
          },
          {
            body: updateIdentitySchema,
          }
        )
        .delete("/", async ({ params, organization, request }) => {
          const hasPermission = await auth.api.hasPermission({
            headers: request.headers,
            body: {
              permissions: {
                integration: ["delete"],
              },
            },
          });

          if (!hasPermission) {
            return status(
              403,
              "You do not have permission to delete identities"
            );
          }

          const existingIdentity = await db.query.providerIdentity.findFirst({
            where: (table, { eq }) => eq(table.id, params.identityId),
            with: {
              providerCredential: true,
            },
          });

          if (
            !existingIdentity ||
            existingIdentity.providerCredential.organizationId !==
              organization.id
          ) {
            return status(
              404,
              "Identity not found or not associated with this organization"
            );
          }

          await db
            .delete(schema.providerIdentity)
            .where(eq(schema.providerIdentity.id, params.identityId));

          return { success: true };
        })
  );
