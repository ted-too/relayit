import type { TemplateChannelVariant } from "@repo/api/db";
import { describe, expect, it } from "vitest";
import { renderEmailTemplateVariant } from "./render-email-variant";

function primitiveVariant(
  overrides: Partial<TemplateChannelVariant> = {}
): TemplateChannelVariant {
  return {
    id: "tcvn_test",
    templateId: "tmpl_test",
    channel: "email",
    engine: "primitive",
    content: {
      subject: "Thanks for {{{PRODUCT}}}",
      html: "<p>Total {{{PRICE}}}</p>",
      text: "Total {{{PRICE}}}",
    },
    variables: {
      PRODUCT: { type: "string", fallback: "item" },
      PRICE: { type: "number" },
    },
    workspaceEntryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("renderEmailTemplateVariant", () => {
  it("renders a primitive email variant with values and fallbacks", async () => {
    const result = await renderEmailTemplateVariant({
      variant: primitiveVariant(),
      values: { PRICE: 25 },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        subject: "Thanks for item",
        html: "<p>Total 25</p>",
        text: "Total 25",
      },
    });
  });

  it("lets subjectOverride win over the rendered subject", async () => {
    const result = await renderEmailTemplateVariant({
      variant: primitiveVariant(),
      values: { PRODUCT: "Laptop", PRICE: 10 },
      subjectOverride: "Custom subject",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subject).toBe("Custom subject");
    }
  });

  it("fails closed when a required variable is missing", async () => {
    const result = await renderEmailTemplateVariant({
      variant: primitiveVariant(),
      values: {},
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "missing_variable", variableName: "PRICE" },
    });
  });

  it("rejects reactEmail when the Workspace Entry link is missing", async () => {
    const result = await renderEmailTemplateVariant({
      variant: primitiveVariant({
        engine: "reactEmail",
        content: null,
        variables: null,
        workspaceEntryId: null,
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "broken_react_email_link" },
    });
  });
});
