import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "@repo/api";
import {
  createProviderCredentialSchema,
  updateProviderCredentialSchema,
  createWebhookEndpointSchema,
  updateWebhookEndpointSchema,
} from "@repo/shared";
import slugify from "slugify";
import { db, schema } from "@repo/api/db";
import { count, eq, and, desc } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  encrypt,
  encryptRecord,
  getSafeEncryptedRecord,
  redactedString,
} from "@repo/api/lib/crypto";

async function generateProviderSlug(name: string, teamId: string) {
  const baseSlug = slugify(name, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await db
      .select({ count: count() })
      .from(schema.providerCredential)
      .where(
        and(
          eq(schema.providerCredential.teamId, teamId),
          eq(schema.providerCredential.slug, slug)
        )
      );

    if (existing[0].count === 0) {
      break;
    }

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  return slug;
}

// --- Provider Credential Routes ---
export const credentialRoutes = new Hono<Context>()
  // POST /teams/:teamId/credentials - Create new provider credentials
  .post("/", zValidator("json", createProviderCredentialSchema), async (c) => {
    const teamId = c.req.param("teamId");
    const validatedData = c.req.valid("json");
    const user = c.get("user");

    if (!teamId) {
      throw new HTTPException(400, { message: "Team ID is required" });
    }

    const slug =
      validatedData.slug ??
      (await generateProviderSlug(validatedData.name, teamId));

    const existingSlug = await db
      .select({ id: schema.providerCredential.id })
      .from(schema.providerCredential)
      .where(
        and(
          eq(schema.providerCredential.teamId, teamId),
          eq(schema.providerCredential.slug, slug)
        )
      )
      .limit(1);

    if (existingSlug.length > 0) {
      throw new HTTPException(409, { message: "Slug already exists" });
    }

    const encryptedCredentials = encryptRecord(validatedData.credentials);

    const [newCredential] = await db
      .insert(schema.providerCredential)
      .values({
        teamId: teamId,
        slug: slug,
        channelType: validatedData.providerType,
        name: validatedData.name,
        credentials: encryptedCredentials,
        isActive: validatedData.isActive,
      })
      .returning();

    if (!newCredential) {
      throw new HTTPException(500, { message: "Failed to create credential" });
    }

    const safeCredential = {
      ...newCredential,
      credentials: getSafeEncryptedRecord(newCredential.credentials),
    };

    return c.json(safeCredential, 201);
  })
  // GET /teams/:teamId/credentials - List credentials for a team
  .get("/", async (c) => {
    const teamId = c.req.param("teamId");

    if (!teamId) {
      throw new HTTPException(400, { message: "Team ID is required" });
    }

    const credentials = await db.query.providerCredential.findMany({
      where: eq(schema.providerCredential.teamId, teamId),
      orderBy: desc(schema.providerCredential.createdAt),
    });

    const safeCredentials = credentials.map((cred) => ({
      ...cred,
      credentials: getSafeEncryptedRecord(cred.credentials),
    }));

    return c.json(safeCredentials);
  })
  // GET /teams/:teamId/credentials/:credentialId - Get specific credential
  .get("/:credentialId", async (c) => {
    const teamId = c.req.param("teamId");
    const credentialId = c.req.param("credentialId");

    if (!teamId) {
      throw new HTTPException(400, { message: "Team ID is required" });
    }

    const credential = await db.query.providerCredential.findFirst({
      where: and(
        eq(schema.providerCredential.teamId, teamId),
        eq(schema.providerCredential.id, credentialId)
      ),
    });

    if (!credential) {
      throw new HTTPException(404, { message: "Credential not found" });
    }

    const safeCredential = {
      ...credential,
      credentials: getSafeEncryptedRecord(credential.credentials),
    };

    return c.json(safeCredential);
  })
  // PATCH /teams/:teamId/credentials/:credentialId - Update credential by ID
  .patch(
    "/:credentialId",
    zValidator("json", updateProviderCredentialSchema),
    async (c) => {
      const teamId = c.req.param("teamId");
      const credentialId = c.req.param("credentialId");
      const validatedData = c.req.valid("json");

      if (!teamId) {
        throw new HTTPException(400, { message: "Team ID is required" });
      }
      if (!credentialId) {
        throw new HTTPException(400, { message: "Credential ID is required" });
      }

      const existingCredential = await db.query.providerCredential.findFirst({
        columns: {
          id: true,
          slug: true,
        },
        where: and(
          eq(schema.providerCredential.id, credentialId),
          eq(schema.providerCredential.teamId, teamId)
        ),
      });

      if (!existingCredential) {
        throw new HTTPException(404, { message: "Credential not found" });
      }

      if (
        validatedData.slug &&
        validatedData.slug !== existingCredential.slug
      ) {
        const slugCheck = await db
          .select({ id: schema.providerCredential.id })
          .from(schema.providerCredential)
          .where(
            and(
              eq(schema.providerCredential.teamId, teamId),
              eq(schema.providerCredential.slug, validatedData.slug)
            )
          )
          .limit(1);

        if (slugCheck.length > 0) {
          throw new HTTPException(409, { message: "Slug already exists" });
        }
      }

      if (validatedData.credentials) {
        validatedData.credentials = encryptRecord(validatedData.credentials);
      }

      if (Object.keys(validatedData).length <= 1) {
        throw new HTTPException(400, {
          message: "No valid fields provided for update",
        });
      }

      const [updatedCredential] = await db
        .update(schema.providerCredential)
        .set(validatedData)
        .where(
          and(
            eq(schema.providerCredential.id, credentialId),
            eq(schema.providerCredential.teamId, teamId)
          )
        )
        .returning();

      if (!updatedCredential) {
        throw new HTTPException(404, {
          message: "Credential not found during update",
        });
      }

      const safeCredential = {
        ...updatedCredential,
        credentials: getSafeEncryptedRecord(updatedCredential.credentials),
      };

      return c.json(safeCredential);
    }
  )
  // DELETE /teams/:teamId/credentials/:credentialId - Delete credential by ID
  .delete("/:credentialId", async (c) => {
    const teamId = c.req.param("teamId");
    const credentialId = c.req.param("credentialId");

    if (!teamId) {
      throw new HTTPException(400, { message: "Team ID is required" });
    }
    if (!credentialId) {
      throw new HTTPException(400, { message: "Credential ID is required" });
    }

    const existingCredential = await db.query.providerCredential.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.providerCredential.id, credentialId),
        eq(schema.providerCredential.teamId, teamId)
      ),
    });

    if (!existingCredential) {
      throw new HTTPException(404, { message: "Credential not found" });
    }

    const { rowCount } = await db
      .delete(schema.providerCredential)
      .where(
        and(
          eq(schema.providerCredential.id, credentialId),
          eq(schema.providerCredential.teamId, teamId)
        )
      );

    if (rowCount === 0) {
      throw new HTTPException(404, {
        message: "Credential not found or already deleted",
      });
    }

    return c.json({ message: "Credential deleted successfully" });
  });

// --- Webhook Endpoint Routes ---
export const webhookRoutes = new Hono<Context>()
  // POST /teams/:teamId/webhooks - Create new webhook endpoint
  .post("/", zValidator("json", createWebhookEndpointSchema), async (c) => {
    const teamId = c.req.param("teamId");
    const validatedData = c.req.valid("json");

    if (!teamId) {
      throw new HTTPException(400, { message: "Team ID is required" });
    }

    const encryptedSecret = validatedData.secret
      ? encrypt(validatedData.secret)
      : null;

    const [newWebhook] = await db
      .insert(schema.webhookEndpoint)
      .values({
        teamId: teamId,
        url: validatedData.url,
        secret: encryptedSecret,
        eventTypes: validatedData.eventTypes,
        isActive: validatedData.isActive,
      })
      .returning();

    const safeWebhook = {
      ...newWebhook,
      secret: encryptedSecret ? redactedString : null,
    };

    return c.json(safeWebhook, 201);
  })
  // GET /teams/:teamId/webhooks - List webhooks for a team
  .get("/", async (c) => {
    const teamId = c.req.param("teamId");

    if (!teamId) {
      throw new HTTPException(400, { message: "Team ID is required" });
    }

    const webhooks = await db.query.webhookEndpoint.findMany({
      where: eq(schema.webhookEndpoint.teamId, teamId),
      orderBy: desc(schema.webhookEndpoint.createdAt),
    });

    const safeWebhooks = webhooks.map((webhook) => ({
      ...webhook,
      secret: webhook.secret ? redactedString : null,
    }));

    return c.json(safeWebhooks);
  })
  // GET /teams/:teamId/webhooks/:webhookId - Get specific webhook
  .get("/:webhookId", async (c) => {
    const teamId = c.req.param("teamId");
    const webhookId = c.req.param("webhookId");

    if (!teamId) {
      throw new HTTPException(400, { message: "Team ID is required" });
    }
    if (!webhookId) {
      throw new HTTPException(400, { message: "Webhook ID is required" });
    }

    const webhook = await db.query.webhookEndpoint.findFirst({
      where: and(
        eq(schema.webhookEndpoint.id, webhookId),
        eq(schema.webhookEndpoint.teamId, teamId)
      ),
    });

    if (!webhook) {
      throw new HTTPException(404, { message: "Webhook endpoint not found" });
    }

    const safeWebhook = {
      ...webhook,
      secret: webhook.secret ? redactedString : null,
    };

    return c.json(safeWebhook);
  })
  // PATCH /teams/:teamId/webhooks/:webhookId - Update webhook
  .patch(
    "/:webhookId",
    zValidator("json", updateWebhookEndpointSchema),
    async (c) => {
      const teamId = c.req.param("teamId");
      const webhookId = c.req.param("webhookId");
      const validatedData = c.req.valid("json");

      if (!teamId) {
        throw new HTTPException(400, { message: "Team ID is required" });
      }
      if (!webhookId) {
        throw new HTTPException(400, { message: "Webhook ID is required" });
      }

      const webhook = await db.query.webhookEndpoint.findFirst({
        columns: {
          id: true,
          url: true,
        },
        where: and(
          eq(schema.webhookEndpoint.id, webhookId),
          eq(schema.webhookEndpoint.teamId, teamId)
        ),
      });

      if (!webhook) {
        throw new HTTPException(404, { message: "Webhook endpoint not found" });
      }

      if (validatedData.secret) {
        validatedData.secret = encrypt(validatedData.secret);
      }

      if (Object.keys(validatedData).length <= 1) {
        throw new HTTPException(400, {
          message: "No valid fields provided for update",
        });
      }

      const [updatedWebhook] = await db
        .update(schema.webhookEndpoint)
        .set(validatedData)
        .where(
          and(
            eq(schema.webhookEndpoint.id, webhookId),
            eq(schema.webhookEndpoint.teamId, teamId)
          )
        )
        .returning();

      if (!updatedWebhook) {
        throw new HTTPException(404, {
          message: "Webhook endpoint not found during update",
        });
      }

      const safeWebhook = {
        ...updatedWebhook,
        secret: updatedWebhook.secret ? redactedString : null,
      };

      return c.json(safeWebhook);
    }
  )
  // DELETE /teams/:teamId/webhooks/:webhookId - Delete webhook
  .delete("/:webhookId", async (c) => {
    const teamId = c.req.param("teamId");
    const webhookId = c.req.param("webhookId");

    if (!teamId) {
      throw new HTTPException(400, { message: "Team ID is required" });
    }
    if (!webhookId) {
      throw new HTTPException(400, { message: "Webhook ID is required" });
    }

    const existingWebhook = await db.query.webhookEndpoint.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.webhookEndpoint.id, webhookId),
        eq(schema.webhookEndpoint.teamId, teamId)
      ),
    });

    if (!existingWebhook) {
      throw new HTTPException(404, { message: "Webhook endpoint not found" });
    }

    const { rowCount } = await db
      .delete(schema.webhookEndpoint)
      .where(
        and(
          eq(schema.webhookEndpoint.id, webhookId),
          eq(schema.webhookEndpoint.teamId, teamId)
        )
      );

    if (rowCount === 0) {
      throw new HTTPException(404, {
        message: "Webhook endpoint not found or already deleted",
      });
    }

    return c.json({ message: "Webhook deleted successfully" });
  });
