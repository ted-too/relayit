import { DB } from "@repo/persistence/db/effect";
import { Effect } from "effect";
import { CustomDomainAdminError } from "./custom-domain.server";

export interface ManagedEmailProviderSummary {
  readonly channelType: "email";
  readonly createdAt: Date;
  readonly id: string;
  readonly isDefault: boolean;
  readonly name: string | null;
  readonly productId: string;
  readonly updatedAt: Date;
  readonly vendorId: string;
}

export interface ProjectProvidersList {
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
      },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainAdminError({
            cause,
            code: "failed",
            message: "Failed to resolve default managed Provider.",
          }),
      ),
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
      },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainAdminError({
            cause,
            code: "failed",
            message: "Failed to resolve default managed Provider.",
          }),
      ),
    );

  return any?.id ?? null;
});

export const listProvidersForProject = () =>
  Effect.gen(function* () {
    const db = yield* DB;

    const managed = yield* db.query.provider
      .findMany({
        columns: {
          channelType: true,
          createdAt: true,
          id: true,
          isDefault: true,
          name: true,
          productId: true,
          updatedAt: true,
          vendorId: true,
        },
        where: {
          channelType: "email",
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainAdminError({
              cause,
              code: "failed",
              message: "Failed to list managed Providers.",
            }),
        ),
      );

    const defaultManagedProviderId = yield* resolveDefaultManagedEmailProviderId;

    return {
      defaultManagedProviderId,
      managed: managed.map((row) => ({
        channelType: "email" as const,
        createdAt: row.createdAt,
        id: row.id,
        isDefault: row.isDefault,
        name: row.name,
        productId: row.productId,
        updatedAt: row.updatedAt,
        vendorId: row.vendorId,
      })),
    } satisfies ProjectProvidersList;
  });
