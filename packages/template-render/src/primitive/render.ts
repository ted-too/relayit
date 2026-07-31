import type {
  PrimitiveEmailContent,
  PrimitiveRenderError,
  PrimitiveRenderedEmail,
  PrimitiveRenderValues,
  PrimitiveVariableDef,
  PrimitiveVariables,
} from "./types";

/** Resend-compatible placeholder: {{{NAME}}} */
const PLACEHOLDER_RE = /\{\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}\}/g;

export type PrimitiveRenderResult =
  | { ok: true; value: PrimitiveRenderedEmail }
  | { ok: false; error: PrimitiveRenderError };

function resolveValue(
  name: string,
  def: PrimitiveVariableDef | undefined,
  values: PrimitiveRenderValues | undefined
): { ok: true; value: string } | { ok: false; error: PrimitiveRenderError } {
  if (!def) {
    return { ok: false, error: { code: "undeclared_placeholder", name } };
  }

  const provided = values?.[name];
  if (provided !== undefined) {
    if (def.type === "string" && typeof provided !== "string") {
      return {
        ok: false,
        error: { code: "type_mismatch", name, expected: "string" },
      };
    }
    if (def.type === "number" && typeof provided !== "number") {
      return {
        ok: false,
        error: { code: "type_mismatch", name, expected: "number" },
      };
    }
    return { ok: true, value: String(provided) };
  }

  if (def.fallback !== undefined) {
    return { ok: true, value: String(def.fallback) };
  }

  return { ok: false, error: { code: "missing_variable", name } };
}

function substitute(
  template: string,
  variables: PrimitiveVariables,
  values: PrimitiveRenderValues | undefined
): { ok: true; value: string } | { ok: false; error: PrimitiveRenderError } {
  let error: PrimitiveRenderError | undefined;
  const out = template.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (error) {
      return "";
    }
    const resolved = resolveValue(name, variables[name], values);
    if (!resolved.ok) {
      error = resolved.error;
      return "";
    }
    return resolved.value;
  });

  if (error) {
    return { ok: false, error };
  }
  return { ok: true, value: out };
}

/**
 * Render a Resend-shaped primitive email Template.
 * Placeholders are `{{{NAME}}}`; variables are string|number with optional fallback.
 */
export function renderPrimitiveEmail(input: {
  content: PrimitiveEmailContent;
  variables?: PrimitiveVariables;
  values?: PrimitiveRenderValues;
}): PrimitiveRenderResult {
  const variables = input.variables ?? {};

  const subject = substitute(input.content.subject, variables, input.values);
  if (!subject.ok) {
    return subject;
  }

  let html: string | undefined;
  if (input.content.html !== undefined) {
    const rendered = substitute(input.content.html, variables, input.values);
    if (!rendered.ok) {
      return rendered;
    }
    html = rendered.value;
  }

  let text: string | undefined;
  if (input.content.text !== undefined) {
    const rendered = substitute(input.content.text, variables, input.values);
    if (!rendered.ok) {
      return rendered;
    }
    text = rendered.value;
  }

  return {
    ok: true,
    value: {
      subject: subject.value,
      ...(html === undefined ? {} : { html }),
      ...(text === undefined ? {} : { text }),
    },
  };
}
