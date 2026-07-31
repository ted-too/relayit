import { db } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import {
  resolveBillingUserId,
  setBillingUserId,
} from "@repo/api/tenancy/billing-user";
import { updateBillingUserBodySchema } from "@repo/api/validators/routes/projects/billing-user";
import { Elysia, status } from "elysia";

export const billingUserRoutes = new Elysia({ prefix: "/billingUser" })
  .use(betterAuthOrganization)
  .guard({
    organization: true,
    auth: true,
  })
  .put(
    "/",
    async ({ body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { billingUser: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to reassign the Billing User"
        );
      }

      const member = await db.query.member.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.organizationId, organization.id),
            eq(table.userId, body.userId)
          ),
        columns: { userId: true },
      });

      if (!member) {
        return status(400, "Billing User must be a member of the Project");
      }

      const previousBillingUserId = await resolveBillingUserId(organization.id);

      await setBillingUserId(organization.id, body.userId);

      return {
        billingUserId: body.userId,
        previousBillingUserId,
      };
    },
    { body: updateBillingUserBodySchema }
  );
