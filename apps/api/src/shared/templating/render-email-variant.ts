import type {
  PrimitiveEmailContent,
  PrimitiveTemplateVariables,
  TemplateChannelVariant,
} from "@repo/api/db";
import { db } from "@repo/api/db";
import { renderPrimitiveEmail } from "@repo/template-render/primitive";
import { renderSealedReactEmailArtifact } from "@repo/template-render/react-email";
import { downloadTemplatingArtifactByKey } from "./storage";

export interface RenderedEmailChannelFormat {
  html?: string;
  subject: string;
  text?: string;
}

export interface RenderEmailVariantError {
  code:
    | "missing_email_variant"
    | "broken_react_email_link"
    | "missing_react_email_artifact"
    | "react_email_render_failed"
    | "invalid_primitive_content"
    | "missing_variable"
    | "type_mismatch"
    | "undeclared_placeholder"
    | "missing_subject";
  message: string;
  variableName?: string;
}

/**
 * Render a Template’s email channel variant into Delivery Channel Format fields.
 * `subjectOverride` wins when set (Resend: request subject overrides template).
 */
export function renderEmailTemplateVariant(input: {
  variant: TemplateChannelVariant | null | undefined;
  values?: Record<string, unknown>;
  subjectOverride?: string;
}): Promise<
  | { ok: true; value: RenderedEmailChannelFormat }
  | { ok: false; error: RenderEmailVariantError }
> {
  const { variant } = input;

  if (variant?.channel !== "email") {
    return Promise.resolve({
      ok: false,
      error: {
        code: "missing_email_variant",
        message: "Template has no email channel variant.",
      },
    });
  }

  if (variant.engine === "reactEmail") {
    return renderReactEmailVariant({
      variant,
      values: input.values,
      subjectOverride: input.subjectOverride,
    });
  }

  const content = variant.content as PrimitiveEmailContent | null;
  if (!content?.subject) {
    return Promise.resolve({
      ok: false,
      error: {
        code: "invalid_primitive_content",
        message: "Primitive email Template is missing content.subject.",
      },
    });
  }

  const values = coercePrimitiveValues(input.values);
  const rendered = renderPrimitiveEmail({
    content,
    variables: (variant.variables as PrimitiveTemplateVariables | null) ?? {},
    values,
  });

  if (!rendered.ok) {
    const { error } = rendered;
    if (error.code === "missing_variable") {
      return Promise.resolve({
        ok: false,
        error: {
          code: "missing_variable" as const,
          message: `Missing required Template variable '${error.name}' (no fallback).`,
          variableName: error.name,
        },
      });
    }
    if (error.code === "type_mismatch") {
      return Promise.resolve({
        ok: false,
        error: {
          code: "type_mismatch" as const,
          message: `Template variable '${error.name}' must be a ${error.expected}.`,
          variableName: error.name,
        },
      });
    }
    return Promise.resolve({
      ok: false,
      error: {
        code: "undeclared_placeholder" as const,
        message: `Template uses undeclared variable '${error.name}'.`,
        variableName: error.name,
      },
    });
  }

  return Promise.resolve({
    ok: true,
    value: {
      subject: input.subjectOverride ?? rendered.value.subject,
      ...(rendered.value.html === undefined
        ? {}
        : { html: rendered.value.html }),
      ...(rendered.value.text === undefined
        ? {}
        : { text: rendered.value.text }),
    },
  });
}

async function renderReactEmailVariant(input: {
  variant: TemplateChannelVariant;
  values?: Record<string, unknown>;
  subjectOverride?: string;
}): Promise<
  | { ok: true; value: RenderedEmailChannelFormat }
  | { ok: false; error: RenderEmailVariantError }
> {
  const { variant } = input;

  const workspaceEntryId = variant.workspaceEntryId;
  if (!workspaceEntryId) {
    return {
      ok: false,
      error: {
        code: "broken_react_email_link",
        message:
          "Template email variant link is broken; relink a Workspace Entry.",
      },
    };
  }

  const entry = await db.query.templatingWorkspaceEntry.findFirst({
    where: (table, { eq: equals, and: combine, isNull }) =>
      combine(equals(table.id, workspaceEntryId), isNull(table.deletedAt)),
  });

  if (!entry) {
    return {
      ok: false,
      error: {
        code: "broken_react_email_link",
        message:
          "Template email variant link is broken; relink a Workspace Entry.",
      },
    };
  }

  if (!entry.artifactStorageKey) {
    return {
      ok: false,
      error: {
        code: "missing_react_email_artifact",
        message:
          "Workspace Entry has no live sealed artifact; Publish the Email Workspace first.",
      },
    };
  }

  const variantSubject =
    typeof variant.content?.subject === "string"
      ? variant.content.subject.trim()
      : "";
  const subject =
    input.subjectOverride !== undefined && input.subjectOverride.length > 0
      ? input.subjectOverride
      : variantSubject;

  if (!subject) {
    return {
      ok: false,
      error: {
        code: "missing_subject",
        message:
          "reactEmail Template is missing content.subject; set subject on the Template email channel.",
      },
    };
  }

  const downloaded = await downloadTemplatingArtifactByKey(
    entry.artifactStorageKey
  );
  if (downloaded.error || !downloaded.data) {
    return {
      ok: false,
      error: {
        code: "react_email_render_failed",
        message:
          downloaded.error?.message ?? "Failed to load sealed render artifact.",
      },
    };
  }

  const rendered = await renderSealedReactEmailArtifact({
    artifact: downloaded.data,
    props: input.values ?? {},
    subjectOverride: subject,
  });

  if (!rendered.ok) {
    return {
      ok: false,
      error: {
        code: "react_email_render_failed",
        message: rendered.error.message,
      },
    };
  }

  return {
    ok: true,
    value: {
      subject: rendered.value.subject,
      html: rendered.value.html,
      ...(rendered.value.text === undefined
        ? {}
        : { text: rendered.value.text }),
    },
  };
}

function coercePrimitiveValues(
  values: Record<string, unknown> | undefined
): Record<string, string | number> | undefined {
  if (!values) {
    return;
  }
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" || typeof value === "number") {
      out[key] = value;
    }
  }
  return out;
}
