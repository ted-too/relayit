import { db, schema } from "@repo/shared/db";
import { createIdentitySchema, updateIdentitySchema } from "@repo/shared/forms";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import z from "zod";
import { auth } from "@/lib/auth";
import { authdOrganizationProcedure, router } from ".";

/**
 * Handles default flag logic for identities - ensures only one default per provider
 * @param providerCredentialId - The provider credential ID
 * @param isDefault - Whether this should be the default
 * @param isFirstIdentityForProvider - Whether this is the first identity for this provider
 */
async function handleIdentityDefaultFlag(
  providerCredentialId: string,
  isDefault: boolean,
  isFirstIdentityForProvider: boolean
): Promise<boolean> {
  const shouldBeDefault = isDefault || isFirstIdentityForProvider;

  if (!shouldBeDefault) return false;

  // Unset any existing defaults for this provider
  await db
    .update(schema.providerIdentity)
    .set({ isDefault: false })
    .where(
      and(
        eq(schema.providerIdentity.providerCredentialId, providerCredentialId),
        eq(schema.providerIdentity.isDefault, true)
      )
    );

  return true;
}

export const identitiesRouter = router({
  list: authdOrganizationProcedure
    .input(
      z.object({
        providerCredentialId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify the provider credential belongs to the organization
      const providerCredential = await db.query.providerCredential.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.id, input.providerCredentialId),
            eq(table.organizationId, ctx.session.activeOrganization.id)
          ),
      });

      if (!providerCredential) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Provider credential not found or not associated with this organization",
        });
      }

      const identities = await db.query.providerIdentity.findMany({
        where: (table, { eq }) =>
          eq(table.providerCredentialId, input.providerCredentialId),
        orderBy: (table, { desc, asc }) => [
          desc(table.isDefault),
          asc(table.createdAt),
        ],
      });

      return identities;
    }),

  create: authdOrganizationProcedure
    .input(createIdentitySchema)
    .mutation(async ({ ctx, input }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: ctx.req.headers,
        body: {
          permissions: {
            integration: ["create"],
          },
        },
      });

      if (!hasPermission) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to create identities",
        });
      }

      // Verify the provider credential belongs to the organization
      const providerCredential = await db.query.providerCredential.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.id, input.providerCredentialId),
            eq(table.organizationId, ctx.session.activeOrganization.id)
          ),
      });

      if (!providerCredential) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Provider credential not found or not associated with this organization",
        });
      }

      // Check if identifier already exists for this provider
      const existingIdentity = await db.query.providerIdentity.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.providerCredentialId, input.providerCredentialId),
            eq(table.identifier, input.identifier)
          ),
      });

      if (existingIdentity) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "An identity with this identifier already exists for this provider",
        });
      }

      // Check if this is the first identity for this provider
      const existingIdentities = await db.query.providerIdentity.findMany({
        where: (table, { eq }) =>
          eq(table.providerCredentialId, input.providerCredentialId),
        columns: { id: true },
      });

      const isFirstIdentityForProvider = existingIdentities.length === 0;

      // Execute in a transaction
      const [newIdentity] = await db.transaction(async (tx) => {
        // Handle default flag
        const shouldBeDefault = await handleIdentityDefaultFlag(
          input.providerCredentialId,
          input.isDefault,
          isFirstIdentityForProvider
        );

        // Insert the identity
        return tx
          .insert(schema.providerIdentity)
          .values({
            providerCredentialId: input.providerCredentialId,
            identifier: input.identifier,
            channelData: input.channelData || {},
            isDefault: shouldBeDefault,
            isActive: input.isActive,
          })
          .returning();
      });

      return newIdentity;
    }),

  update: authdOrganizationProcedure
    .input(updateIdentitySchema)
    .mutation(async ({ ctx, input }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: ctx.req.headers,
        body: {
          permissions: {
            integration: ["update"],
          },
        },
      });

      if (!hasPermission) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to update identities",
        });
      }

      // Find the identity and verify it belongs to the organization
      const existingIdentity = await db.query.providerIdentity.findFirst({
        where: (table, { eq }) => eq(table.id, input.id),
        with: {
          providerCredential: true,
        },
      });

      if (
        !existingIdentity ||
        existingIdentity.providerCredential.organizationId !==
          ctx.session.activeOrganization.id
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Identity not found or not associated with this organization",
        });
      }

      // If updating identifier, check for conflicts
      if (
        input.identifier &&
        input.identifier !== existingIdentity.identifier
      ) {
        const newIdentifier = input.identifier; // TypeScript guard
        const conflictingIdentity = await db.query.providerIdentity.findFirst({
          where: (table, { eq, and, ne }) =>
            and(
              eq(
                table.providerCredentialId,
                existingIdentity.providerCredentialId
              ),
              eq(table.identifier, newIdentifier),
              ne(table.id, input.id)
            ),
        });

        if (conflictingIdentity) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "An identity with this identifier already exists for this provider",
          });
        }
      }

      // Execute in a transaction
      const [updatedIdentity] = await db.transaction(async (tx) => {
        // Handle default flag if being updated
        if (input.isDefault !== undefined) {
          await handleIdentityDefaultFlag(
            existingIdentity.providerCredentialId,
            input.isDefault,
            false // This is not a new identity
          );
        }

        // Update the identity
        return tx
          .update(schema.providerIdentity)
          .set({
            identifier: input.identifier,
            channelData: input.channelData,
            isDefault: input.isDefault,
            isActive: input.isActive,
          })
          .where(eq(schema.providerIdentity.id, input.id))
          .returning();
      });

      return updatedIdentity;
    }),

  delete: authdOrganizationProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: ctx.req.headers,
        body: {
          permissions: {
            integration: ["delete"],
          },
        },
      });

      if (!hasPermission) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to delete identities",
        });
      }

      // Find the identity and verify it belongs to the organization
      const existingIdentity = await db.query.providerIdentity.findFirst({
        where: (table, { eq }) => eq(table.id, input.id),
        with: {
          providerCredential: true,
        },
      });

      if (
        !existingIdentity ||
        existingIdentity.providerCredential.organizationId !==
          ctx.session.activeOrganization.id
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Identity not found or not associated with this organization",
        });
      }

      // Delete the identity
      await db
        .delete(schema.providerIdentity)
        .where(eq(schema.providerIdentity.id, input.id));

      return { success: true };
    }),
});
