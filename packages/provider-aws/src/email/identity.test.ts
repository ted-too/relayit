import { describe, expect, test } from "bun:test";
import { Data, Effect } from "effect";
import { ensureSesDomainIdentity, type SesIdentityClient } from "./identity";

class NotFoundException extends Data.TaggedError("NotFoundException")<{
  readonly message: string;
}> {}

class BadRequestException extends Data.TaggedError("BadRequestException")<{
  readonly message: string;
}> {}

class SdkError extends Data.TaggedError("SdkError")<{
  readonly message: string;
}> {}

type Origin = "AWS_SES" | "EXTERNAL";

const input = {
  dkimPrivateKey: "private-key",
  dkimSelector: "relayitabc123",
  fqdn: "relayit.fyi",
  region: "eu-central-1",
} as const;

const mailFrom = {
  domain: "send.relayit.fyi",
  records: [
    {
      name: "send.relayit.fyi",
      priority: 10,
      purpose: "mail_from_mx" as const,
      recordType: "MX" as const,
      value: "feedback-smtp.eu-central-1.amazonses.com",
    },
    {
      name: "send.relayit.fyi",
      priority: null,
      purpose: "mail_from_spf" as const,
      recordType: "TXT" as const,
      value: '"v=spf1 include:amazonses.com ~all"',
    },
  ],
};

const makeSes = (options: {
  readonly existingOrigin?: Origin;
  readonly rejectExternalPut?: "BadRequestException" | "SdkError";
}) => {
  let origin: Origin | null = options.existingOrigin ?? null;
  let deleted = false;

  const ses = {
    createEmailIdentity: () => {
      origin = "EXTERNAL";
      return Effect.succeed({});
    },
    deleteEmailIdentity: () => {
      deleted = true;
      origin = null;
      return Effect.succeed({});
    },
    getEmailIdentity: () =>
      origin
        ? Effect.succeed({
            DkimAttributes: { SigningAttributesOrigin: origin },
          })
        : Effect.fail(new NotFoundException({ message: "Not found" })),
    putEmailIdentityDkimSigningAttributes: () => {
      if (!origin) {
        return Effect.fail(new NotFoundException({ message: "Not found" }));
      }
      if (options.rejectExternalPut === "BadRequestException") {
        return Effect.fail(
          new BadRequestException({
            message: "Cannot switch Easy DKIM to BYODKIM",
          })
        );
      }
      if (options.rejectExternalPut === "SdkError") {
        return Effect.fail(
          new SdkError({
            message: "Already exists",
          })
        );
      }
      origin = "EXTERNAL";
      return Effect.succeed({});
    },
    putEmailIdentityMailFromAttributes: () => Effect.succeed({}),
  } as unknown as SesIdentityClient;

  return {
    get deleted() {
      return deleted;
    },
    get origin() {
      return origin;
    },
    ses,
  };
};

describe("ensureSesDomainIdentity", () => {
  test("creates a BYODKIM identity when SES has none", async () => {
    const fake = makeSes({});

    const result = await Effect.runPromise(
      ensureSesDomainIdentity(fake.ses, input)
    );

    expect(result).toEqual({
      mailFrom,
      providerData: { dkimSelector: "relayitabc123" },
    });
    expect(fake.origin).toBe("EXTERNAL");
    expect(fake.deleted).toBe(false);
  });

  test("rewrites an existing Easy DKIM identity to BYODKIM", async () => {
    const fake = makeSes({ existingOrigin: "AWS_SES" });

    await Effect.runPromise(ensureSesDomainIdentity(fake.ses, input));

    expect(fake.origin).toBe("EXTERNAL");
    expect(fake.deleted).toBe(false);
  });

  test("replaces Easy DKIM when SES rejects the BYODKIM conversion", async () => {
    const fake = makeSes({
      existingOrigin: "AWS_SES",
      rejectExternalPut: "BadRequestException",
    });

    await Effect.runPromise(ensureSesDomainIdentity(fake.ses, input));

    expect(fake.origin).toBe("EXTERNAL");
    expect(fake.deleted).toBe(true);
  });

  test("replaces Easy DKIM when the conversion error is wrapped as SdkError", async () => {
    const fake = makeSes({
      existingOrigin: "AWS_SES",
      rejectExternalPut: "SdkError",
    });

    await Effect.runPromise(ensureSesDomainIdentity(fake.ses, input));

    expect(fake.origin).toBe("EXTERNAL");
    expect(fake.deleted).toBe(true);
  });

  test("updates DKIM keys on an existing BYODKIM identity", async () => {
    const fake = makeSes({ existingOrigin: "EXTERNAL" });

    await Effect.runPromise(ensureSesDomainIdentity(fake.ses, input));

    expect(fake.origin).toBe("EXTERNAL");
    expect(fake.deleted).toBe(false);
  });
});
