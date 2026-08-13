import { DB } from "@repo/persistence/db/effect";
import { Effect } from "effect";

export interface ApiKeyCreatedBy {
  readonly email: string;
  readonly image: string | null;
  readonly name: string;
}

export interface HydratedApiKey {
  readonly createdAt: Date;
  readonly createdBy: ApiKeyCreatedBy | null;
  readonly end: string | null;
  readonly expiresAt: Date | null;
  readonly id: string;
  readonly lastRequest: Date | null;
  readonly name: string | null;
  readonly start: string | null;
}

interface ApiKeyMetadata {
  readonly createdBy?: string;
  readonly end?: string | null;
}

interface RawApiKey {
  readonly createdAt: Date;
  readonly expiresAt?: Date | null;
  readonly id: string;
  readonly lastRequest?: Date | null;
  readonly metadata?: unknown;
  readonly name?: string | null;
  readonly start?: string | null;
}

const readMetadata = (metadata: unknown): ApiKeyMetadata | null => {
  if (!(metadata && typeof metadata === "object")) {
    return null;
  }
  return metadata as ApiKeyMetadata;
};

export const hydrateApiKey = (apiKey: RawApiKey) =>
  Effect.gen(function* () {
    const meta = readMetadata(apiKey.metadata);
    const createdById = meta?.createdBy;
    if (!createdById) {
      return {
        createdAt: apiKey.createdAt,
        createdBy: null,
        end: meta?.end ?? null,
        expiresAt: apiKey.expiresAt ?? null,
        id: apiKey.id,
        lastRequest: apiKey.lastRequest ?? null,
        name: apiKey.name ?? null,
        start: apiKey.start ?? null,
      } satisfies HydratedApiKey;
    }

    const db = yield* DB;
    const createdBy = yield* db.query.user
      .findFirst({
        columns: { email: true, image: true, name: true },
        where: { id: createdById },
      })
      .pipe(Effect.orDie);

    return {
      createdAt: apiKey.createdAt,
      createdBy: createdBy
        ? {
            email: createdBy.email,
            image: createdBy.image,
            name: createdBy.name,
          }
        : null,
      end: meta?.end ?? null,
      expiresAt: apiKey.expiresAt ?? null,
      id: apiKey.id,
      lastRequest: apiKey.lastRequest ?? null,
      name: apiKey.name ?? null,
      start: apiKey.start ?? null,
    } satisfies HydratedApiKey;
  });
