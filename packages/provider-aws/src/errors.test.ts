import { ProviderMessageError } from "@repo/channels/provider-errors";
import { describe, expect, it } from "vitest";
import { awsSesProviderDefinition } from "./client";
import { AwsUnexpectedResponseError, createAwsErrorMapper } from "./errors";

const context = {
  providerId: "prv_test",
  typeId: awsSesProviderDefinition.typeId,
} as const;
const mapAwsError = createAwsErrorMapper(context);

describe("mapAwsError", () => {
  it("preserves structured provider message errors", () => {
    const error = new ProviderMessageError({
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
      _tag: "ProviderUnavailable",
      cause,
      ...context,
    });
  });
});
