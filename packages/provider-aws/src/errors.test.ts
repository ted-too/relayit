import { EmailBackendMessageError } from "@repo/channels/email/backend";
import { describe, expect, it } from "@effect/vitest";
import { AwsUnexpectedResponseError, createAwsErrorMapper } from "./errors";

const context = { region: "eu-central-1" } as const;
const mapAwsError = createAwsErrorMapper(context);

describe("mapAwsError", () => {
  it("preserves structured message errors", () => {
    const error = new EmailBackendMessageError({
      ...context,
      code: "invalid_attachment_encoding",
      filename: "invoice.pdf",
    });

    expect(mapAwsError(error)).toBe(error);
  });

  it("preserves missing AWS response fields as the unavailable cause", () => {
    const cause = new AwsUnexpectedResponseError({
      missingField: "MessageId",
      operation: "SendEmail",
    });

    expect(mapAwsError(cause)).toMatchObject({
      _tag: "EmailBackendUnavailable",
      cause,
      ...context,
    });
  });
});
