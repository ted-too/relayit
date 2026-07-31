import { describe, expect, it } from "vitest";
import { renderSealedReactEmailArtifact } from "./render";

const ARTIFACT = `
import * as React from "react";

function Email({ name, currency }) {
  return React.createElement(
    "div",
    null,
    "Hi ",
    name,
    " ",
    currency
  );
}

Email.PreviewProps = {
  name: "Joshua",
  currency: "USD",
};

export default Email;
`;

describe("renderSealedReactEmailArtifact", () => {
  it("renders with a caller-provided subject and props", async () => {
    const result = await renderSealedReactEmailArtifact({
      artifact: ARTIFACT,
      props: { name: "Ada", currency: "EUR" },
      subject: "Hello Ada",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.subject).toBe("Hello Ada");
    expect(result.value.html).toContain("Ada");
    expect(result.value.html).toContain("EUR");
    expect(result.value.props).toEqual({ name: "Ada", currency: "EUR" });
  });

  it("does not merge PreviewProps on send (default)", async () => {
    const result = await renderSealedReactEmailArtifact({
      artifact: ARTIFACT,
      props: {},
      subject: "Hello",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // currency missing — component still renders (undefined stringifies empty)
    expect(result.value.props).toEqual({});
  });

  it("merges PreviewProps under caller props when enabled", async () => {
    const result = await renderSealedReactEmailArtifact({
      artifact: ARTIFACT,
      props: { name: "Ted" },
      subject: "Hello",
      mergePreviewProps: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.props).toEqual({ name: "Ted", currency: "USD" });
    expect(result.value.html).toContain("Ted");
    expect(result.value.html).toContain("USD");
  });

  it("fails when subject is missing", async () => {
    const result = await renderSealedReactEmailArtifact({
      artifact: ARTIFACT,
      props: {},
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "missing_subject" },
    });
  });
});
