import { DB } from "@repo/persistence/db/effect";
import {
  type PrimitiveTemplateVariables,
  type TemplateEmailVariantContent,
  template,
  templateChannelVariant,
} from "@repo/persistence/db/schema";
import { generateDbSlug, slugify } from "@repo/persistence/db/slug";
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { Data, Effect } from "effect";

export class TemplateCatalogError extends Data.TaggedError(
  "TemplateCatalogError"
)<{
  readonly cause?: unknown;
  readonly code: "not_found" | "failed" | "forbidden" | "conflict";
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
}> {}

export interface TemplateListItem {
  readonly archivedAt: Date | null;
  readonly channelVariants: readonly {
    readonly broken: boolean;
    readonly channel: string;
    readonly content: TemplateEmailVariantContent | null;
    readonly createdAt: Date;
    readonly engine: string;
    readonly id: string;
    readonly updatedAt: Date;
    readonly variables: PrimitiveTemplateVariables | null;
    readonly workspaceEntryId: string | null;
  }[];
  readonly createdAt: Date;
  readonly id: string;
  readonly name: string;
  readonly organizationId: string;
  readonly slug: string;
  readonly updatedAt: Date;
}

const serializeTemplate = (row: {
  archivedAt: Date | null;
  channelVariants: readonly {
    content: TemplateEmailVariantContent | null;
    createdAt: Date;
    engine: string;
    id: string;
    channel: string;
    updatedAt: Date;
    variables: PrimitiveTemplateVariables | null;
    workspaceEntryId: string | null;
    workspaceEntry?: {
      artifactStorageKey: string | null;
      deletedAt: Date | null;
    } | null;
  }[];
  createdAt: Date;
  id: string;
  name: string;
  organizationId: string;
  slug: string;
  updatedAt: Date;
}): TemplateListItem => ({
  archivedAt: row.archivedAt,
  channelVariants: row.channelVariants.map((variant) => {
    const entry = variant.workspaceEntry;
    const missingLink = !variant.workspaceEntryId;
    const broken =
      variant.engine === "reactEmail" &&
      (missingLink || !(entry && !entry.deletedAt && entry.artifactStorageKey));

    return {
      broken,
      channel: variant.channel,
      content: variant.content,
      createdAt: variant.createdAt,
      engine: variant.engine,
      id: variant.id,
      updatedAt: variant.updatedAt,
      variables: variant.variables,
      workspaceEntryId: variant.workspaceEntryId,
    };
  }),
  createdAt: row.createdAt,
  id: row.id,
  name: row.name,
  organizationId: row.organizationId,
  slug: row.slug,
  updatedAt: row.updatedAt,
});

export const listTemplatesForProject = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const rows = yield* db.query.template
      .findMany({
        orderBy: { createdAt: "asc" },
        where: { organizationId },
        with: {
          channelVariants: {
            with: { workspaceEntry: true },
          },
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new TemplateCatalogError({
              cause,
              code: "failed",
              message: "Failed to list Templates.",
            })
        )
      );

    return rows.map(serializeTemplate);
  });

export const getTemplateForProject = (input: {
  readonly organizationId: string;
  readonly templateId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const row = yield* db.query.template
      .findFirst({
        where: {
          id: input.templateId,
          organizationId: input.organizationId,
        },
        with: {
          channelVariants: {
            with: { workspaceEntry: true },
          },
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new TemplateCatalogError({
              cause,
              code: "failed",
              message: "Failed to load Template.",
            })
        )
      );

    if (!row) {
      return yield* new TemplateCatalogError({
        code: "not_found",
        message: "Template not found.",
      });
    }

    return serializeTemplate(row);
  });

export const createTemplateForProject = (input: {
  readonly name: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const slug = yield* generateDbSlug(db, template, input.name, {
      scope: and(
        eq(template.organizationId, input.organizationId),
        isNull(template.archivedAt)
      ),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new TemplateCatalogError({
            cause,
            code: "failed",
            message: "Failed to allocate Template slug.",
          })
      )
    );

    const [created] = yield* db
      .insert(template)
      .values({
        name: input.name,
        organizationId: input.organizationId,
        slug,
      })
      .returning()
      .pipe(
        Effect.mapError(
          (cause) =>
            new TemplateCatalogError({
              cause,
              code: "failed",
              message: "Failed to create Template.",
            })
        )
      );

    if (!created) {
      return yield* new TemplateCatalogError({
        code: "failed",
        message: "Failed to create Template.",
      });
    }

    return serializeTemplate({ ...created, channelVariants: [] });
  });

const loadTemplateRow = (input: {
  readonly organizationId: string;
  readonly templateId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* DB;
    return yield* db.query.template
      .findFirst({
        where: {
          id: input.templateId,
          organizationId: input.organizationId,
        },
        with: {
          channelVariants: {
            with: { workspaceEntry: true },
          },
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new TemplateCatalogError({
              cause,
              code: "failed",
              message: "Failed to load Template.",
            })
        )
      );
  });

export const archiveTemplateForProject = (input: {
  readonly organizationId: string;
  readonly templateId: string;
}) =>
  Effect.gen(function* () {
    const existing = yield* loadTemplateRow(input);
    if (!existing) {
      return yield* new TemplateCatalogError({
        code: "not_found",
        message: "Template not found.",
      });
    }
    if (existing.archivedAt) {
      return serializeTemplate(existing);
    }

    const db = yield* DB;
    const [archived] = yield* db
      .update(template)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(template.id, existing.id),
          eq(template.organizationId, input.organizationId),
          isNull(template.archivedAt)
        )
      )
      .returning()
      .pipe(
        Effect.mapError(
          (cause) =>
            new TemplateCatalogError({
              cause,
              code: "failed",
              message: "Failed to archive Template.",
            })
        )
      );

    return serializeTemplate({
      ...existing,
      ...(archived ?? {}),
    });
  });

export const updateTemplateSlugForProject = (input: {
  readonly organizationId: string;
  readonly slug: string;
  readonly templateId: string;
}) =>
  Effect.gen(function* () {
    const existing = yield* loadTemplateRow(input);
    if (!existing) {
      return yield* new TemplateCatalogError({
        code: "not_found",
        message: "Template not found.",
      });
    }
    if (existing.archivedAt) {
      return yield* new TemplateCatalogError({
        code: "conflict",
        message: "Archived Templates cannot be updated.",
      });
    }

    const normalized = slugify(input.slug);
    if (!normalized) {
      return yield* new TemplateCatalogError({
        code: "failed",
        message: "Slug is invalid.",
      });
    }

    if (normalized === existing.slug) {
      return serializeTemplate(existing);
    }

    const db = yield* DB;
    const takenRows = yield* db
      .select({ count: count() })
      .from(template)
      .where(
        and(
          eq(template.organizationId, input.organizationId),
          eq(template.slug, normalized),
          isNull(template.archivedAt),
          ne(template.id, existing.id)
        )
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new TemplateCatalogError({
              cause,
              code: "failed",
              message: "Failed to check Template slug.",
            })
        )
      );

    if ((takenRows[0]?.count ?? 0) > 0) {
      return yield* new TemplateCatalogError({
        code: "conflict",
        message: "A Template with this slug already exists in the Project.",
      });
    }

    const [updated] = yield* db
      .update(template)
      .set({ slug: normalized })
      .where(
        and(
          eq(template.id, existing.id),
          eq(template.organizationId, input.organizationId),
          isNull(template.archivedAt)
        )
      )
      .returning()
      .pipe(
        Effect.mapError(
          (cause) =>
            new TemplateCatalogError({
              cause,
              code: "failed",
              message: "Failed to update Template slug.",
            })
        )
      );

    return serializeTemplate({
      ...existing,
      ...(updated ?? {}),
    });
  });

export const putReactEmailChannelForProject = (input: {
  readonly organizationId: string;
  readonly subject: string;
  readonly templateId: string;
  readonly workspaceEntryId: string;
}) =>
  Effect.gen(function* () {
    const existing = yield* loadTemplateRow(input);
    if (!existing) {
      return yield* new TemplateCatalogError({
        code: "not_found",
        message: "Template not found.",
      });
    }
    if (existing.archivedAt) {
      return yield* new TemplateCatalogError({
        code: "conflict",
        message: "Archived Templates cannot be updated.",
      });
    }

    const db = yield* DB;
    const entry = yield* db.query.templatingWorkspaceEntry
      .findFirst({
        where: {
          id: input.workspaceEntryId,
        },
        with: { workspace: true },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new TemplateCatalogError({
              cause,
              code: "failed",
              message: "Failed to load Workspace Entry.",
            })
        )
      );

    if (
      !entry ||
      entry.deletedAt ||
      !entry.workspace ||
      entry.workspace.organizationId !== input.organizationId ||
      entry.workspace.kind !== "reactEmail"
    ) {
      return yield* new TemplateCatalogError({
        code: "not_found",
        message: "Workspace Entry not found.",
      });
    }

    if (!(entry.artifactStorageKey && !entry.deletedAt)) {
      return yield* new TemplateCatalogError({
        code: "conflict",
        message: "Workspace Entry is not pickable until a successful Publish.",
      });
    }

    const now = new Date();
    const values = {
      channel: "email" as const,
      content: { subject: input.subject },
      engine: "reactEmail" as const,
      templateId: existing.id,
      updatedAt: now,
      variables: null,
      workspaceEntryId: entry.id,
    };

    const currentEmail = existing.channelVariants.find(
      (variant) => variant.channel === "email"
    );

    if (currentEmail) {
      yield* db
        .update(templateChannelVariant)
        .set(values)
        .where(eq(templateChannelVariant.id, currentEmail.id))
        .pipe(
          Effect.mapError(
            (cause) =>
              new TemplateCatalogError({
                cause,
                code: "failed",
                message: "Failed to update email channel.",
              })
          )
        );
    } else {
      yield* db
        .insert(templateChannelVariant)
        .values({
          ...values,
          createdAt: now,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TemplateCatalogError({
                cause,
                code: "failed",
                message: "Failed to create email channel.",
              })
          )
        );
    }

    const refreshed = yield* loadTemplateRow(input);
    if (!refreshed) {
      return yield* new TemplateCatalogError({
        code: "not_found",
        message: "Template not found.",
      });
    }
    return serializeTemplate(refreshed);
  });
