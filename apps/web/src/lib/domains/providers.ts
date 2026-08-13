import { DB } from "@repo/persistence/db/effect";
import { Effect } from "effect";
import { CustomDomainAdminError } from "./custom-domain";

export interface ManagedEmailProviderSummary {
  readonly channelType: "email";
  readonly createdAt: Date;
  readonly id: string;
  readonly isDefault: boolean;
  readonly name: string | null;
  readonly productId: string;
  readonly scope: "platform";
  readonly updatedAt: Date;
  readonly vendorId: string;
}

export interface ProjectProvidersList {
  readonly byo: readonly {
    readonly channelType: string;
    readonly createdAt: Date;
    readonly id: string;
    readonly isDefault: boolean;
    readonly name: string | null;
    readonly productId: string;
    readonly scope: "project";
    readonly updatedAt: Date;
    readonly vendorId: string;
  }[];
  readonly defaultManagedProviderId: string | null;
  readonly managed: readonly ManagedEmailProviderSummary[];
}

export const resolveDefaultManagedEmailProviderId = Effect.gen(function* () {
  const db = yield* DB;
  const defaults = yield* db.query.provider
    .findFirst({
      columns: { id: true },
      where: {
        channelType: "email",
        isDefault: true,
        scope: "platform",
      },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainAdminError({
            cause,
            code: "failed",
            message: "Failed to resolve default managed Provider.",
          })
      )
    );

  if (defaults) {
    return defaults.id;
  }

  const any = yield* db.query.provider
    .findFirst({
      columns: { id: true },
      orderBy: { createdAt: "asc" },
      where: {
        channelType: "email",
        scope: "platform",
      },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainAdminError({
            cause,
            code: "failed",
            message: "Failed to resolve default managed Provider.",
          })
      )
    );

  return any?.id ?? null;
});

export const listProvidersForProject = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;

    const byo = yield* db.query.provider
      .findMany({
        columns: {
          channelType: true,
          createdAt: true,
          id: true,
          isDefault: true,
          name: true,
          productId: true,
          scope: true,
          updatedAt: true,
          vendorId: true,
        },
        where: {
          organizationId,
          scope: "project",
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainAdminError({
              cause,
              code: "failed",
              message: "Failed to list Project Providers.",
            })
        )
      );

    const managed = yield* db.query.provider
      .findMany({
        columns: {
          channelType: true,
          createdAt: true,
          id: true,
          isDefault: true,
          name: true,
          productId: true,
          scope: true,
          updatedAt: true,
          vendorId: true,
        },
        where: {
          channelType: "email",
          scope: "platform",
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainAdminError({
              cause,
              code: "failed",
              message: "Failed to list managed Providers.",
            })
        )
      );

    const defaultManagedProviderId =
      yield* resolveDefaultManagedEmailProviderId;

    return {
      byo: byo.flatMap((row) =>
        row.scope === "project"
          ? [
              {
                channelType: row.channelType,
                createdAt: row.createdAt,
                id: row.id,
                isDefault: row.isDefault,
                name: row.name,
                productId: row.productId,
                scope: "project" as const,
                updatedAt: row.updatedAt,
                vendorId: row.vendorId,
              },
            ]
          : []
      ),
      defaultManagedProviderId,
      managed: managed.flatMap((row) =>
        row.scope === "platform" && row.channelType === "email"
          ? [
              {
                channelType: "email" as const,
                createdAt: row.createdAt,
                id: row.id,
                isDefault: row.isDefault,
                name: row.name,
                productId: row.productId,
                scope: "platform" as const,
                updatedAt: row.updatedAt,
                vendorId: row.vendorId,
              },
            ]
          : []
      ),
    } satisfies ProjectProvidersList;
  });
