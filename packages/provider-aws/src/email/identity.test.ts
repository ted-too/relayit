import { describe, expect, it } from "@effect/vitest";
import { Data, Effect } from "effect";
import { deleteSesDomainIdentity, ensureSesDomainIdentity } from "./identity";

class NotFoundException extends Data.TaggedError("NotFoundException")<{
  readonly message: string;
}> {}

class AlreadyExistsException extends Data.TaggedError("AlreadyExistsException")<{
  readonly message: string;
}> {}

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

interface Identity {
  readonly mailFromDomain?: string;
  readonly origin: "AWS_SES" | "EXTERNAL";
  readonly tokens: readonly string[];
}

/** One SES region holding at most the identity `relayit.fyi`, answering as SES does. */
const makeSes = (existing?: Identity) => {
  let identity: Identity | null = existing ?? null;
  const calls: string[] = [];

  const ses = {
    createEmailIdentity: (request: {
      readonly DkimSigningAttributes: { readonly DomainSigningSelector: string };
    }) => {
      calls.push("create");
      if (identity) {
        return Effect.fail(new AlreadyExistsException({ message: "Already exists" }));
      }
      identity = {
        origin: "EXTERNAL",
        tokens: [request.DkimSigningAttributes.DomainSigningSelector],
      };
      return Effect.succeed({});
    },
    deleteEmailIdentity: () => {
      calls.push("delete");
      identity = null;
      return Effect.succeed({});
    },
    deleteTenantResourceAssociation: () => {
      calls.push("detach");
      return Effect.succeed({});
    },
    getEmailIdentity: () => {
      calls.push("get");
      return identity
        ? Effect.succeed({
            DkimAttributes: { SigningAttributesOrigin: identity.origin, Tokens: identity.tokens },
          })
        : Effect.fail(new NotFoundException({ message: "Not found" }));
    },
    listResourceTenants: () =>
      Effect.succeed({ ResourceTenants: [{ TenantName: "relayit-orgn_1" }] }),
    listTenants: () =>
      Effect.succeed({
        Tenants: [{ TenantArn: "arn:aws:ses:eu-central-1:123456789012:tenant/relayit-orgn_1" }],
      }),
    putEmailIdentityMailFromAttributes: (request: { readonly MailFromDomain: string }) => {
      calls.push("mail-from");
      if (identity) {
        identity = { ...identity, mailFromDomain: request.MailFromDomain };
      }
      return Effect.succeed({});
    },
  };

  return {
    calls,
    get identity() {
      return identity;
    },
    // The stub answers the calls these functions make, not the whole SES client.
    ses: ses as unknown as Parameters<typeof deleteSesDomainIdentity>[0] &
      Parameters<typeof ensureSesDomainIdentity>[0],
  };
};

/** Identities the account can hold that Relayit did not make for this Domain. */
const outside = [
  ["Easy DKIM, as the SES console makes one", { origin: "AWS_SES", tokens: ["a", "b", "c"] }],
  ["BYODKIM with another selector", { origin: "EXTERNAL", tokens: ["relayitffff0000"] }],
  ["Easy DKIM whose token is the selector", { origin: "AWS_SES", tokens: ["relayitabc123"] }],
] as const satisfies readonly (readonly [string, Identity])[];

describe("ensureSesDomainIdentity", () => {
  it.effect("creates a BYODKIM identity with the Domain's selector when SES has none", () =>
    Effect.gen(function* () {
      const account = makeSes();

      const result = yield* ensureSesDomainIdentity(account.ses, input);

      expect(result).toEqual({ mailFrom });
      expect(account.identity).toEqual({
        mailFromDomain: "send.relayit.fyi",
        origin: "EXTERNAL",
        tokens: ["relayitabc123"],
      });
    }),
  );

  it.effect("takes the identity an earlier attempt made with the Domain's selector", () =>
    Effect.gen(function* () {
      const account = makeSes({ origin: "EXTERNAL", tokens: ["relayitabc123"] });

      const result = yield* ensureSesDomainIdentity(account.ses, input);

      expect(result).toEqual({ mailFrom });
      expect(account.calls).toEqual(["create", "get", "mail-from"]);
    }),
  );

  it.effect.each(outside)("refuses %s, and leaves it untouched", ([, existing]) =>
    Effect.gen(function* () {
      const account = makeSes(existing);

      const error = yield* Effect.flip(ensureSesDomainIdentity(account.ses, input));

      expect(error).toMatchObject({
        _tag: "EmailBackendIdentityConflict",
        fqdn: "relayit.fyi",
        region: "eu-central-1",
      });
      expect(account.identity).toEqual(existing);
      expect(account.calls).toEqual(["create", "get"]);
    }),
  );
});

describe("deleteSesDomainIdentity", () => {
  it.effect("deletes the identity made with the Domain's selector, off its tenants first", () =>
    Effect.gen(function* () {
      const account = makeSes({ origin: "EXTERNAL", tokens: ["relayitabc123"] });

      expect(yield* deleteSesDomainIdentity(account.ses, input)).toBe(true);

      expect(account.identity).toBeNull();
      expect(account.calls).toEqual(["get", "detach", "delete"]);
    }),
  );

  it.effect.each(outside)("leaves %s", ([, existing]) =>
    Effect.gen(function* () {
      const account = makeSes(existing);

      expect(yield* deleteSesDomainIdentity(account.ses, input)).toBe(false);

      expect(account.identity).toEqual(existing);
      expect(account.calls).toEqual(["get"]);
    }),
  );

  it.effect("has nothing to delete when SES has no identity of that name", () =>
    Effect.gen(function* () {
      const account = makeSes();

      expect(yield* deleteSesDomainIdentity(account.ses, input)).toBe(false);

      expect(account.calls).toEqual(["get"]);
    }),
  );
});
