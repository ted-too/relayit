import { ObjectStorage } from "@repo/object-storage";
import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import {
  type PrimitiveEmailContent,
  type PrimitiveTemplateVariables,
  template,
  templateChannelVariant,
  templatingWorkspaceEntry,
} from "@repo/persistence/db/schema";
import {
  renderPrimitiveEmail,
  renderSealedReactEmailArtifact,
} from "@repo/template-render";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import type { EmailContentInput } from "./contracts";
import { EmailAcceptInfrastructureError, EmailAcceptRejected } from "./errors";

export interface PreparedEmailContent {
  readonly html?: string;
  readonly subject: string;
  readonly templateId?: string;
  readonly text?: string;
}

const primitiveValues = (
  values: Readonly<Record<string, unknown>> | undefined
): Record<string, string | number> | undefined => {
  if (!values) {
    return;
  }
  const prepared: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === "string" || typeof value === "number") {
      prepared[name] = value;
    }
  }
  return prepared;
};

export const prepareEmailContent = (
  db: DatabaseExecutor,
  input: {
    readonly content: EmailContentInput;
    readonly organizationId: string;
  }
) => {
  const reference = input.content;
  if (reference.kind === "inline") {
    return Effect.succeed({
      html: reference.html,
      subject: reference.subject,
      templateId: undefined,
      text: reference.text,
    } satisfies PreparedEmailContent);
  }

  return Effect.gen(function* () {
    const byId = reference.idOrSlug.startsWith("tmpl_");
    const [resolvedTemplate] = yield* db
      .select({ id: template.id })
      .from(template)
      .where(
        and(
          byId
            ? eq(template.id, reference.idOrSlug)
            : eq(template.slug, reference.idOrSlug),
          eq(template.organizationId, input.organizationId),
          isNull(template.archivedAt)
        )
      )
      .limit(1)
      .pipe(
        Effect.mapError(
          (cause) =>
            new EmailAcceptInfrastructureError({
              cause,
              operation: "content",
              organizationId: input.organizationId,
            })
        )
      );

    if (!resolvedTemplate) {
      return yield* new EmailAcceptRejected({
        code: "template_not_found",
        message: "Template not found (or archived) for this Project.",
      });
    }

    const [variant] = yield* db
      .select()
      .from(templateChannelVariant)
      .where(
        and(
          eq(templateChannelVariant.templateId, resolvedTemplate.id),
          eq(templateChannelVariant.channel, "email")
        )
      )
      .limit(1)
      .pipe(
        Effect.mapError(
          (cause) =>
            new EmailAcceptInfrastructureError({
              cause,
              operation: "content",
              organizationId: input.organizationId,
            })
        )
      );

    if (!variant) {
      return yield* new EmailAcceptRejected({
        code: "missing_email_variant",
        message: "Template has no email channel variant.",
      });
    }

    if (variant.engine === "primitive") {
      const content = variant.content as PrimitiveEmailContent | null;
      if (!content?.subject) {
        return yield* new EmailAcceptRejected({
          code: "invalid_primitive_content",
          message: "Primitive email Template is missing content.subject.",
        });
      }

      const rendered = renderPrimitiveEmail({
        content,
        values: primitiveValues(reference.values),
        variables:
          (variant.variables as PrimitiveTemplateVariables | null) ?? {},
      });
      if (!rendered.ok) {
        const messages = {
          missing_variable: "Missing required Template variable (no fallback).",
          type_mismatch: "Template variable has the wrong type.",
          undeclared_placeholder: "Template uses an undeclared variable.",
        } as const;
        return yield* new EmailAcceptRejected({
          code: rendered.error.code,
          details: { variable: rendered.error.name },
          message: messages[rendered.error.code],
        });
      }

      return {
        html: rendered.value.html,
        subject: reference.subjectOverride ?? rendered.value.subject,
        templateId: resolvedTemplate.id,
        text: rendered.value.text,
      } satisfies PreparedEmailContent;
    }

    if (!variant.workspaceEntryId) {
      return yield* new EmailAcceptRejected({
        code: "broken_react_email_link",
        message:
          "Template email variant link is broken; relink a Workspace Entry.",
      });
    }

    const [entry] = yield* db
      .select({
        artifactStorageKey: templatingWorkspaceEntry.artifactStorageKey,
      })
      .from(templatingWorkspaceEntry)
      .where(
        and(
          eq(templatingWorkspaceEntry.id, variant.workspaceEntryId),
          isNull(templatingWorkspaceEntry.deletedAt)
        )
      )
      .limit(1)
      .pipe(
        Effect.mapError(
          (cause) =>
            new EmailAcceptInfrastructureError({
              cause,
              operation: "content",
              organizationId: input.organizationId,
            })
        )
      );
    if (!entry) {
      return yield* new EmailAcceptRejected({
        code: "broken_react_email_link",
        message:
          "Template email variant link is broken; relink a Workspace Entry.",
      });
    }
    if (!entry.artifactStorageKey) {
      return yield* new EmailAcceptRejected({
        code: "missing_react_email_artifact",
        message:
          "Workspace Entry has no live sealed artifact; Publish the Email Workspace first.",
      });
    }

    const variantSubject =
      typeof variant.content?.subject === "string"
        ? variant.content.subject.trim()
        : "";
    const subject = reference.subjectOverride?.trim() || variantSubject;
    if (!subject) {
      return yield* new EmailAcceptRejected({
        code: "missing_subject",
        message: "reactEmail Template is missing content.subject.",
      });
    }

    const storage = yield* ObjectStorage;
    const artifact = yield* storage.download(entry.artifactStorageKey).pipe(
      Effect.mapError(
        (cause) =>
          new EmailAcceptInfrastructureError({
            cause,
            operation: "content",
            organizationId: input.organizationId,
          })
      )
    );
    const rendered = yield* Effect.promise(() =>
      renderSealedReactEmailArtifact({
        artifact: artifact.body,
        props: reference.values ?? {},
        subjectOverride: subject,
      })
    );
    if (!rendered.ok) {
      return yield* new EmailAcceptRejected({
        code: "react_email_render_failed",
        details: { detail: rendered.error.message },
        message: "Failed to render react-email Template.",
      });
    }

    return {
      html: rendered.value.html,
      subject: rendered.value.subject,
      templateId: resolvedTemplate.id,
      text: rendered.value.text,
    } satisfies PreparedEmailContent;
  });
};
