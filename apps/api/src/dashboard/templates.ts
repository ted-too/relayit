import {
  Conflict,
  DashboardApi,
  DashboardMember,
  Invalid,
  NotFound,
  type Template,
} from "@repo/contracts/dashboard";
import { DB } from "@repo/persistence/db/effect";
import {
  type PrimitiveTemplateVariables,
  type TemplateEmailVariantContent,
  template,
  templateChannelVariant,
} from "@repo/persistence/db/schema";
import { generateDbSlug, slugify } from "@repo/persistence/db/slug";
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { operationFailed } from "./failures";

const templateNotFound = new NotFound({ message: "Template not found." });
const archived = new Conflict({ message: "Archived Templates cannot be updated." });

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
}): Template => ({
  archivedAt: row.archivedAt,
  channelVariants: row.channelVariants.map((variant) => {
    const entry = variant.workspaceEntry;
    return {
      broken:
        variant.engine === "reactEmail" &&
        (!variant.workspaceEntryId || !(entry && !entry.deletedAt && entry.artifactStorageKey)),
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

/** One of the Project's Templates, with its variants and their Workspace Entries. */
const loadTemplate = (input: { readonly organizationId: string; readonly templateId: string }) =>
  Effect.gen(function* () {
    const db = yield* DB;
    return yield* db.query.template
      .findFirst({
        where: { id: input.templateId, organizationId: input.organizationId },
        with: { channelVariants: { with: { workspaceEntry: true } } },
      })
      .pipe(Effect.catch(operationFailed("Failed to load Template.")));
  });

/** The Template, for a change: present and not archived. */
const changeableTemplate = (input: {
  readonly organizationId: string;
  readonly templateId: string;
}) =>
  Effect.gen(function* () {
    const existing = yield* loadTemplate(input);
    if (!existing) {
      return yield* templateNotFound;
    }
    if (existing.archivedAt) {
      return yield* archived;
    }
    return existing;
  });

export const templateHandlers = HttpApiBuilder.group(DashboardApi, "templates", (handlers) =>
  Effect.succeed(
    handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          const db = yield* DB;
          const rows = yield* db.query.template
            .findMany({
              orderBy: { createdAt: "asc" },
              where: { organizationId },
              with: { channelVariants: { with: { workspaceEntry: true } } },
            })
            .pipe(Effect.catch(operationFailed("Failed to list Templates.")));
          return rows.map(serializeTemplate);
        }),
      )
      .handle("get", ({ params }) =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          const row = yield* loadTemplate({ organizationId, templateId: params.templateId });
          if (!row) {
            return yield* templateNotFound;
          }
          return serializeTemplate(row);
        }),
      )
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          const db = yield* DB;
          const slug = yield* generateDbSlug(db, template, payload.name, {
            scope: and(eq(template.organizationId, organizationId), isNull(template.archivedAt)),
          }).pipe(Effect.catch(operationFailed("Failed to allocate Template slug.")));
          const [created] = yield* db
            .insert(template)
            .values({ name: payload.name, organizationId, slug })
            .returning()
            .pipe(Effect.catch(operationFailed("Failed to create Template.")));
          if (!created) {
            return yield* operationFailed("Failed to create Template.")(slug);
          }
          return serializeTemplate({ ...created, channelVariants: [] });
        }),
      )
      .handle("archive", ({ params }) =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          const existing = yield* loadTemplate({ organizationId, templateId: params.templateId });
          if (!existing) {
            return yield* templateNotFound;
          }
          if (existing.archivedAt) {
            return serializeTemplate(existing);
          }
          const db = yield* DB;
          const [updated] = yield* db
            .update(template)
            .set({ archivedAt: new Date() })
            .where(
              and(
                eq(template.id, existing.id),
                eq(template.organizationId, organizationId),
                isNull(template.archivedAt),
              ),
            )
            .returning()
            .pipe(Effect.catch(operationFailed("Failed to archive Template.")));
          return serializeTemplate({ ...existing, ...updated });
        }),
      )
      .handle("updateSlug", ({ params, payload }) =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          const existing = yield* changeableTemplate({
            organizationId,
            templateId: params.templateId,
          });
          const slug = slugify(payload.slug);
          if (!slug) {
            return yield* new Invalid({ message: "Slug is invalid." });
          }
          if (slug === existing.slug) {
            return serializeTemplate(existing);
          }
          const db = yield* DB;
          const [taken] = yield* db
            .select({ count: count() })
            .from(template)
            .where(
              and(
                eq(template.organizationId, organizationId),
                eq(template.slug, slug),
                isNull(template.archivedAt),
                ne(template.id, existing.id),
              ),
            )
            .pipe(Effect.catch(operationFailed("Failed to check Template slug.")));
          if ((taken?.count ?? 0) > 0) {
            return yield* new Conflict({
              message: "A Template with this slug already exists in the Project.",
            });
          }
          const [updated] = yield* db
            .update(template)
            .set({ slug })
            .where(
              and(
                eq(template.id, existing.id),
                eq(template.organizationId, organizationId),
                isNull(template.archivedAt),
              ),
            )
            .returning()
            .pipe(Effect.catch(operationFailed("Failed to update Template slug.")));
          return serializeTemplate({ ...existing, ...updated });
        }),
      )
      .handle("linkReactEmail", ({ params, payload }) =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          const existing = yield* changeableTemplate({
            organizationId,
            templateId: params.templateId,
          });
          const db = yield* DB;
          const entry = yield* db.query.templatingWorkspaceEntry
            .findFirst({ where: { id: payload.workspaceEntryId }, with: { workspace: true } })
            .pipe(Effect.catch(operationFailed("Failed to load Workspace Entry.")));
          if (
            !entry ||
            entry.deletedAt ||
            !entry.workspace ||
            entry.workspace.organizationId !== organizationId ||
            entry.workspace.kind !== "reactEmail"
          ) {
            return yield* new NotFound({ message: "Workspace Entry not found." });
          }
          if (!entry.artifactStorageKey) {
            return yield* new Conflict({
              message: "Workspace Entry is not pickable until a successful Publish.",
            });
          }

          const now = new Date();
          const values = {
            channel: "email" as const,
            content: { subject: payload.subject },
            engine: "reactEmail" as const,
            templateId: existing.id,
            updatedAt: now,
            variables: null,
            workspaceEntryId: entry.id,
          };
          const currentEmail = existing.channelVariants.find(
            (variant) => variant.channel === "email",
          );
          yield* (
            currentEmail
              ? db
                  .update(templateChannelVariant)
                  .set(values)
                  .where(eq(templateChannelVariant.id, currentEmail.id))
              : db.insert(templateChannelVariant).values({ ...values, createdAt: now })
          ).pipe(Effect.catch(operationFailed("Failed to save email channel.")));

          const refreshed = yield* loadTemplate({ organizationId, templateId: existing.id });
          if (!refreshed) {
            return yield* templateNotFound;
          }
          return serializeTemplate(refreshed);
        }),
      ),
  ),
);
