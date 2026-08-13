import { type DatabaseTransaction, DB } from "@repo/persistence/db/effect";
import { webhookEndpoint } from "@repo/persistence/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { setWebhookEndpointEnabled } from "./endpoint-lifecycle";
import { WebhookManagementError } from "./errors";
import type { WebhookEventType } from "./events";
import { generateWebhookSigningSecret } from "./signing";

export interface PublicWebhookEndpoint {
  readonly createdAt: Date;
  readonly enabled: boolean;
  readonly eventTypes: readonly string[];
  readonly hasPreviousSecret: boolean;
  readonly id: string;
  readonly organizationId: string;
  readonly previousSecretExpiresAt: Date | null;
  readonly tagFilter: Readonly<Record<string, string>> | null;
  readonly updatedAt: Date;
  readonly url: string;
}

const publicEndpoint = (
  endpoint: typeof webhookEndpoint.$inferSelect
): PublicWebhookEndpoint => ({
  createdAt: endpoint.createdAt,
  enabled: endpoint.enabled,
  eventTypes: endpoint.eventTypes,
  hasPreviousSecret: endpoint.previousSigningSecret !== null,
  id: endpoint.id,
  organizationId: endpoint.organizationId,
  previousSecretExpiresAt: endpoint.previousSecretExpiresAt,
  tagFilter: endpoint.tagFilter,
  updatedAt: endpoint.updatedAt,
  url: endpoint.url,
});

const operationFailed = (message: string, cause: unknown) =>
  new WebhookManagementError({
    cause,
    code: "operation_failed",
    message,
  });

export const listWebhookEndpoints = (
  organizationId: string
): Effect.Effect<
  readonly PublicWebhookEndpoint[],
  WebhookManagementError,
  DB
> =>
  Effect.gen(function* () {
    const db = yield* DB;
    const endpoints = yield* db
      .select()
      .from(webhookEndpoint)
      .where(eq(webhookEndpoint.organizationId, organizationId))
      .orderBy(asc(webhookEndpoint.createdAt))
      .pipe(
        Effect.mapError((cause) =>
          operationFailed("Webhook Endpoints could not be listed", cause)
        )
      );
    return endpoints.map(publicEndpoint);
  });

export const getWebhookEndpoint = (
  organizationId: string,
  endpointId: string
): Effect.Effect<PublicWebhookEndpoint, WebhookManagementError, DB> =>
  Effect.gen(function* () {
    const db = yield* DB;
    const [endpoint] = yield* db
      .select()
      .from(webhookEndpoint)
      .where(
        and(
          eq(webhookEndpoint.id, endpointId),
          eq(webhookEndpoint.organizationId, organizationId)
        )
      )
      .pipe(
        Effect.mapError((cause) =>
          operationFailed("Webhook Endpoint could not be loaded", cause)
        )
      );
    if (!endpoint) {
      return yield* new WebhookManagementError({
        code: "endpoint_not_found",
        message: "Webhook Endpoint not found",
      });
    }
    return publicEndpoint(endpoint);
  });

export interface CreateWebhookEndpointInput {
  readonly enabled: boolean;
  readonly eventTypes: readonly WebhookEventType[];
  readonly organizationId: string;
  readonly tagFilter?: Readonly<Record<string, string>> | null;
  readonly url: string;
}

export interface CreatedWebhookEndpoint extends PublicWebhookEndpoint {
  readonly signingSecret: string;
}

export const createWebhookEndpoint = (
  transaction: DatabaseTransaction,
  input: CreateWebhookEndpointInput
): Effect.Effect<CreatedWebhookEndpoint, WebhookManagementError> =>
  Effect.gen(function* () {
    const signingSecret = generateWebhookSigningSecret();
    const [endpoint] = yield* transaction
      .insert(webhookEndpoint)
      .values({
        enabled: input.enabled,
        eventTypes: [...input.eventTypes],
        organizationId: input.organizationId,
        signingSecret,
        tagFilter: input.tagFilter,
        url: input.url,
      })
      .returning()
      .pipe(
        Effect.mapError((cause) =>
          operationFailed("Webhook Endpoint could not be created", cause)
        )
      );
    if (!endpoint) {
      return yield* operationFailed(
        "Webhook Endpoint could not be created",
        new Error("Webhook Endpoint insert returned no record")
      );
    }

    return {
      ...publicEndpoint(endpoint),
      signingSecret,
    };
  });

export interface UpdateWebhookEndpointInput {
  readonly enabled?: boolean;
  readonly endpointId: string;
  readonly eventTypes?: readonly WebhookEventType[];
  readonly organizationId: string;
  readonly tagFilter?: Readonly<Record<string, string>> | null;
  readonly url?: string;
}

export const updateWebhookEndpoint = (
  transaction: DatabaseTransaction,
  input: UpdateWebhookEndpointInput
): Effect.Effect<PublicWebhookEndpoint, WebhookManagementError> =>
  Effect.gen(function* () {
    const [existing] = yield* transaction
      .select()
      .from(webhookEndpoint)
      .where(
        and(
          eq(webhookEndpoint.id, input.endpointId),
          eq(webhookEndpoint.organizationId, input.organizationId)
        )
      );
    if (!existing) {
      return yield* new WebhookManagementError({
        code: "endpoint_not_found",
        message: "Webhook Endpoint not found",
      });
    }

    const [updated] = yield* transaction
      .update(webhookEndpoint)
      .set({
        ...(input.eventTypes === undefined
          ? {}
          : { eventTypes: [...input.eventTypes] }),
        ...(input.tagFilter === undefined
          ? {}
          : { tagFilter: input.tagFilter }),
        ...(input.url === undefined ? {} : { url: input.url }),
      })
      .where(eq(webhookEndpoint.id, existing.id))
      .returning();

    if (input.enabled !== undefined && input.enabled !== existing.enabled) {
      yield* setWebhookEndpointEnabled(transaction, {
        enabled: input.enabled,
        endpointId: existing.id,
        organizationId: input.organizationId,
      });
    }

    return publicEndpoint({
      ...(updated ?? existing),
      enabled: input.enabled ?? existing.enabled,
    });
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "WebhookManagementError"
        ? error
        : operationFailed("Webhook Endpoint could not be updated", error)
    )
  );

export const deleteWebhookEndpoint = (
  transaction: DatabaseTransaction,
  organizationId: string,
  endpointId: string
): Effect.Effect<string, WebhookManagementError> =>
  Effect.gen(function* () {
    const [deleted] = yield* transaction
      .delete(webhookEndpoint)
      .where(
        and(
          eq(webhookEndpoint.id, endpointId),
          eq(webhookEndpoint.organizationId, organizationId)
        )
      )
      .returning({ id: webhookEndpoint.id });
    if (!deleted) {
      return yield* new WebhookManagementError({
        code: "endpoint_not_found",
        message: "Webhook Endpoint not found",
      });
    }
    return deleted.id;
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "WebhookManagementError"
        ? error
        : operationFailed("Webhook Endpoint could not be deleted", error)
    )
  );
