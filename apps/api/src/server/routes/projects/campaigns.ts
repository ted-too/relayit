import { resolveEmailSender } from "@repo/api/channels/email/sender";
import { db, schema } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import {
  campaignIdParamsSchema,
  createCampaignBodySchema,
  patchCampaignBodySchema,
  putCampaignEmailChannelBodySchema,
} from "@repo/api/validators/routes/projects/campaigns";
import { and, eq, isNull } from "drizzle-orm";
import { Elysia, status } from "elysia";

function findCampaignInOrganization(
  campaignId: string,
  organizationId: string
) {
  return db.query.campaign.findFirst({
    where: (table, { eq, and }) =>
      and(eq(table.id, campaignId), eq(table.organizationId, organizationId)),
    with: {
      channelFroms: true,
    },
  });
}

function serializeCampaign(
  row: NonNullable<Awaited<ReturnType<typeof findCampaignInOrganization>>>
) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    topicId: row.topicId,
    templateId: row.templateId,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    channelFroms: row.channelFroms.map((channelFrom) => ({
      id: channelFrom.id,
      channel: channelFrom.channel,
      from: channelFrom.from,
      createdAt: channelFrom.createdAt,
      updatedAt: channelFrom.updatedAt,
    })),
  };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

type RefCheck = { ok: true } | { ok: false; code: 404 | 409; message: string };

async function requireActiveTopic(
  topicId: string,
  organizationId: string
): Promise<RefCheck> {
  const topic = await db.query.topic.findFirst({
    where: (table, { eq, and }) =>
      and(eq(table.id, topicId), eq(table.organizationId, organizationId)),
  });

  if (!topic) {
    return { ok: false, code: 404, message: "Topic not found" };
  }

  if (topic.archivedAt) {
    return { ok: false, code: 409, message: "Topic is archived" };
  }

  return { ok: true };
}

async function requireActiveTemplate(
  templateId: string,
  organizationId: string
): Promise<RefCheck> {
  const template = await db.query.template.findFirst({
    where: (table, { eq, and }) =>
      and(eq(table.id, templateId), eq(table.organizationId, organizationId)),
  });

  if (!template) {
    return { ok: false, code: 404, message: "Template not found" };
  }

  if (template.archivedAt) {
    return { ok: false, code: 409, message: "Template is archived" };
  }

  return { ok: true };
}

export const campaignsRoutes = new Elysia({ prefix: "/campaigns" })
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
        permissions: { campaign: ["read"] },
      },
    });

    if (!hasPermission) {
      return status(403, "You do not have permission to read Campaigns");
    }

    const rows = await db.query.campaign.findMany({
      where: (table, { eq }) => eq(table.organizationId, organization.id),
      orderBy: (table, { asc }) => [asc(table.createdAt)],
      with: {
        channelFroms: true,
      },
    });

    return rows.map(serializeCampaign);
  })
  .post(
    "/",
    async ({ body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { campaign: ["create"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to create Campaigns");
      }

      const topicCheck = await requireActiveTopic(
        body.topicId,
        organization.id
      );
      if (!topicCheck.ok) {
        return status(topicCheck.code, topicCheck.message);
      }

      const templateCheck = await requireActiveTemplate(
        body.templateId,
        organization.id
      );
      if (!templateCheck.ok) {
        return status(templateCheck.code, templateCheck.message);
      }

      try {
        const [created] = await db
          .insert(schema.campaign)
          .values({
            organizationId: organization.id,
            name: body.name,
            topicId: body.topicId,
            templateId: body.templateId,
            updatedAt: new Date(),
          })
          .returning();

        return serializeCampaign({
          ...created,
          channelFroms: [],
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return status(409, "A Campaign with this name already exists");
        }
        throw error;
      }
    },
    { body: createCampaignBodySchema }
  )
  .get(
    "/:id",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { campaign: ["read"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to read Campaigns");
      }

      const existing = await findCampaignInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Campaign not found");
      }

      return serializeCampaign(existing);
    },
    { params: campaignIdParamsSchema }
  )
  .patch(
    "/:id",
    async ({ params, body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { campaign: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update Campaigns");
      }

      const existing = await findCampaignInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Campaign not found");
      }

      if (existing.archivedAt) {
        return status(409, "Archived Campaigns cannot be updated");
      }

      if (body.topicId !== undefined) {
        const topicCheck = await requireActiveTopic(
          body.topicId,
          organization.id
        );
        if (!topicCheck.ok) {
          return status(topicCheck.code, topicCheck.message);
        }
      }

      if (body.templateId !== undefined) {
        const templateCheck = await requireActiveTemplate(
          body.templateId,
          organization.id
        );
        if (!templateCheck.ok) {
          return status(templateCheck.code, templateCheck.message);
        }
      }

      try {
        const patch: {
          name?: string;
          topicId?: string;
          templateId?: string;
        } = {};
        if (body.name !== undefined) {
          patch.name = body.name;
        }
        if (body.topicId !== undefined) {
          patch.topicId = body.topicId;
        }
        if (body.templateId !== undefined) {
          patch.templateId = body.templateId;
        }

        const [updated] = await db
          .update(schema.campaign)
          .set(patch)
          .where(
            and(
              eq(schema.campaign.id, existing.id),
              eq(schema.campaign.organizationId, organization.id),
              isNull(schema.campaign.archivedAt)
            )
          )
          .returning();

        if (!updated) {
          return status(404, "Campaign not found");
        }

        const refreshed = await findCampaignInOrganization(
          updated.id,
          organization.id
        );

        if (!refreshed) {
          return status(404, "Campaign not found");
        }

        return serializeCampaign(refreshed);
      } catch (error) {
        if (isUniqueViolation(error)) {
          return status(409, "A Campaign with this name already exists");
        }
        throw error;
      }
    },
    {
      params: campaignIdParamsSchema,
      body: patchCampaignBodySchema,
    }
  )
  .post(
    "/:id/archive",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { campaign: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to archive Campaigns");
      }

      const existing = await findCampaignInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Campaign not found");
      }

      if (existing.archivedAt) {
        return serializeCampaign(existing);
      }

      const [archived] = await db
        .update(schema.campaign)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(schema.campaign.id, existing.id),
            eq(schema.campaign.organizationId, organization.id),
            isNull(schema.campaign.archivedAt)
          )
        )
        .returning();

      const refreshed = await findCampaignInOrganization(
        (archived ?? existing).id,
        organization.id
      );

      if (!refreshed) {
        return status(404, "Campaign not found");
      }

      return serializeCampaign(refreshed);
    },
    { params: campaignIdParamsSchema }
  )
  .put(
    "/:id/channels/email",
    async ({ params, body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { campaign: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update Campaigns");
      }

      const existing = await findCampaignInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Campaign not found");
      }

      if (existing.archivedAt) {
        return status(409, "Archived Campaigns cannot be updated");
      }

      const sender = await resolveEmailSender({
        db,
        organizationId: organization.id,
        fromAddress: body.from.address,
      });

      if (!sender) {
        return status(400, "From address is not send-ready for this Project");
      }

      const now = new Date();
      const currentEmail = existing.channelFroms.find(
        (channelFrom) => channelFrom.channel === "email"
      );

      if (currentEmail) {
        await db
          .update(schema.campaignChannelFrom)
          .set({
            from: body.from,
            updatedAt: now,
          })
          .where(eq(schema.campaignChannelFrom.id, currentEmail.id));
      } else {
        await db.insert(schema.campaignChannelFrom).values({
          campaignId: existing.id,
          channel: "email",
          from: body.from,
          createdAt: now,
          updatedAt: now,
        });
      }

      const refreshed = await findCampaignInOrganization(
        existing.id,
        organization.id
      );

      if (!refreshed) {
        return status(404, "Campaign not found");
      }

      return serializeCampaign(refreshed);
    },
    {
      params: campaignIdParamsSchema,
      body: putCampaignEmailChannelBodySchema,
    }
  )
  .delete(
    "/:id/channels/email",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { campaign: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update Campaigns");
      }

      const existing = await findCampaignInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Campaign not found");
      }

      if (existing.archivedAt) {
        return status(409, "Archived Campaigns cannot be updated");
      }

      await db
        .delete(schema.campaignChannelFrom)
        .where(
          and(
            eq(schema.campaignChannelFrom.campaignId, existing.id),
            eq(schema.campaignChannelFrom.channel, "email")
          )
        );

      const refreshed = await findCampaignInOrganization(
        existing.id,
        organization.id
      );

      if (!refreshed) {
        return status(404, "Campaign not found");
      }

      return serializeCampaign(refreshed);
    },
    { params: campaignIdParamsSchema }
  );
