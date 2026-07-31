import { describe, expect, it } from "vitest";
import { renderPrimitiveEmail } from "./render";

describe("renderPrimitiveEmail", () => {
  it("substitutes provided string and number values", () => {
    const result = renderPrimitiveEmail({
      content: {
        subject: "Thanks for {{{PRODUCT}}}",
        html: "<p>Total: {{{PRICE}}}</p>",
        text: "Total: {{{PRICE}}}",
      },
      variables: {
        PRODUCT: { type: "string" },
        PRICE: { type: "number" },
      },
      values: {
        PRODUCT: "Laptop",
        PRICE: 25,
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        subject: "Thanks for Laptop",
        html: "<p>Total: 25</p>",
        text: "Total: 25",
      },
    });
  });

  it("uses fallback when a value is omitted", () => {
    const result = renderPrimitiveEmail({
      content: {
        subject: "Hello {{{NAME}}}",
        text: "Hi {{{NAME}}}",
      },
      variables: {
        NAME: { type: "string", fallback: "friend" },
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        subject: "Hello friend",
        text: "Hi friend",
      },
    });
  });

  it("fails when a variable has no value and no fallback", () => {
    const result = renderPrimitiveEmail({
      content: {
        subject: "Code {{{CODE}}}",
        text: "{{{CODE}}}",
      },
      variables: {
        CODE: { type: "string" },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "missing_variable", name: "CODE" },
    });
  });

  it("fails on type mismatch", () => {
    const result = renderPrimitiveEmail({
      content: {
        subject: "Price {{{PRICE}}}",
        text: "{{{PRICE}}}",
      },
      variables: {
        PRICE: { type: "number", fallback: 0 },
      },
      values: {
        PRICE: "cheap",
      },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "type_mismatch", name: "PRICE", expected: "number" },
    });
  });

  it("fails when a placeholder is not declared", () => {
    const result = renderPrimitiveEmail({
      content: {
        subject: "Hi {{{UNKNOWN}}}",
        text: "x",
      },
      variables: {},
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "undeclared_placeholder", name: "UNKNOWN" },
    });
  });
});
