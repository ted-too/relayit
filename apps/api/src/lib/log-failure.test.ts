import { describe, expect, test } from "bun:test";
import { Data } from "effect";
import { failureAnnotations } from "./log-failure";

class ProviderConfigurationError extends Data.TaggedError(
  "ProviderConfigurationError"
)<{
  readonly code: "provider_configuration_rejected";
  readonly providerId: string;
  readonly typeId: string;
}> {}

class SandboxDomainError extends Data.TaggedError("SandboxDomainError")<{
  readonly cause?: unknown;
  readonly message: string;
  readonly operation: "create";
  readonly providerId: string;
}> {}

class SandboxAdminError extends Data.TaggedError("SandboxAdminError")<{
  readonly cause?: unknown;
  readonly code: "failed";
  readonly message: string;
}> {}

describe("failureAnnotations", () => {
  test("keeps outer code and fills identifiers from nested provider cause", () => {
    const error = new SandboxAdminError({
      cause: new SandboxDomainError({
        cause: new ProviderConfigurationError({
          code: "provider_configuration_rejected",
          providerId: "prov_1",
          typeId: "aws.ses",
        }),
        message: "Provider identity registration failed.",
        operation: "create",
        providerId: "prov_1",
      }),
      code: "failed",
      message: "Could not create Sandbox Domain.",
    });

    expect(failureAnnotations(error)).toEqual({
      causeCode: "provider_configuration_rejected",
      causeTag: "SandboxDomainError",
      code: "failed",
      errorMessage: "Could not create Sandbox Domain.",
      errorTag: "SandboxAdminError",
      operation: "create",
      providerId: "prov_1",
      typeId: "aws.ses",
    });
  });

  test("skips empty string fields from TaggedError defaults", () => {
    const error = new SandboxAdminError({
      code: "failed",
      message: "",
    });

    expect(failureAnnotations(error)).toEqual({
      code: "failed",
      errorTag: "SandboxAdminError",
    });
  });
});
