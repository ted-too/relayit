import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import { apiRedis } from "@repo/api/server/lib/redis";
import { resolveBillingUserId } from "@repo/api/tenancy/billing-user";
import { getUsageSnapshot } from "@repo/api/tenancy/plans";
import { Elysia, status } from "elysia";

export const usageRoutes = new Elysia({ prefix: "/usage" })
  .use(betterAuthOrganization)
  .guard({
    organization: true,
    auth: true,
  })
  .get("/", async ({ organization, request }) => {
    const hasPermission = await auth.api.hasPermission({
      headers: request.headers,
      body: {
        organizationId: organization.id,
        permissions: { usage: ["read"] },
      },
    });

    if (!hasPermission) {
      return status(403, "You do not have permission to read Usage");
    }

    const billingUserId = await resolveBillingUserId(organization.id);

    if (!billingUserId) {
      return status(500, "Billing User not found for this Project");
    }

    return getUsageSnapshot({
      billingUserId,
      redis: apiRedis,
    });
  });
