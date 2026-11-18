import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { CreateDomainInput, CreateProjectInput } from "./schemas";

const decodeCreateDomain = Schema.decodeUnknownSync(CreateDomainInput);

describe("dashboard input schemas", () => {
  it("trims and lowercases a Domain before checking it", () => {
    expect(decodeCreateDomain({ fqdn: "  Mail.Example.COM " })).toEqual({
      fqdn: "mail.example.com",
    });
    expect(() => decodeCreateDomain({ fqdn: "not a domain" })).toThrow("Invalid FQDN");
  });

  it("gives a form the message a person can act on", () => {
    const result = Schema.toStandardSchemaV1(CreateProjectInput)["~standard"].validate({
      name: "Acme!",
    });
    expect(result).toEqual({
      issues: [
        {
          message: "Only letters, numbers, underscores, spaces, and hyphens are allowed",
          path: ["name"],
        },
      ],
    });
  });
});
