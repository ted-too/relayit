import { describe, expect, it } from "vitest";
import { renderSealedReactEmailArtifact } from "./render";

const ARTIFACT = `
import * as React from "react";

export function subject({ name }) {
  return "Hello " + name;
}

export default function Email({ name }) {
  return React.createElement("div", null, "Hi ", name);
}
`;

describe("renderSealedReactEmailArtifact", () => {
  it("renders html/text/subject from a sealed ESM artifact", async () => {
    const result = await renderSealedReactEmailArtifact({
      artifact: ARTIFACT,
      props: { name: "Ada" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.subject).toBe("Hello Ada");
    expect(result.value.html).toContain("Hi");
    expect(result.value.html).toContain("Ada");
    expect(result.value.text).toContain("Hi");
    expect(result.value.text).toContain("Ada");
  });

  it("fails when subject is missing and not overridden", async () => {
    const result = await renderSealedReactEmailArtifact({
      artifact: `
import * as React from "react";
export default function Email() {
  return React.createElement("div", null, "x");
}
`,
      props: {},
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "missing_subject" },
    });
  });
});
