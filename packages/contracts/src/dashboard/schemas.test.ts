import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { CreateDomainInput, CreateProjectInput, ProjectSlug, projectSlugFromName } from "./schemas";

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

  it("takes a Project slug of lowercase letters, digits and single hyphens", () => {
    const isSlug = Schema.is(ProjectSlug);
    // Production's slugs, which must stay valid.
    for (const slug of ["tsavaro", "publika", "dailyintentions", "shambalytics"]) {
      expect([slug, isSlug(slug)]).toEqual([slug, true]);
    }
    for (const slug of ["local", "acme-mail", "a1", "2fa", "x".repeat(48)]) {
      expect([slug, isSlug(slug)]).toEqual([slug, true]);
    }
    for (const slug of [
      "acme.io",
      "Acme",
      "acme_mail",
      "acme mail",
      "-acme",
      "acme-",
      "acme--mail",
      "a",
      "",
      "x".repeat(49),
      "admin",
      "create-project",
      "config.js",
      "favicon.ico",
    ]) {
      expect([slug, isSlug(slug)]).toEqual([slug, false]);
    }
    expect(() => Schema.decodeUnknownSync(ProjectSlug)("acme.io")).toThrow(
      "A Project slug is lowercase letters, digits and hyphens, with no hyphen at either end or two together.",
    );
    expect(() => Schema.decodeUnknownSync(ProjectSlug)("admin")).toThrow(
      "That Project slug is reserved.",
    );
  });

  it("derives a valid slug from any Project name", () => {
    expect(projectSlugFromName("Acme.io Mail")).toBe("acme-io-mail");
    expect(projectSlugFromName("  --Daily   Intentions--  ")).toBe("daily-intentions");
    expect(projectSlugFromName("Admin")).toBe("admin-project");
    expect(projectSlugFromName("A")).toBe("project");
    expect(projectSlugFromName("...")).toBe("project");
    const long = projectSlugFromName(`${"word ".repeat(20)}`);
    expect(long.length).toBeLessThanOrEqual(44);
    expect(long.endsWith("-")).toBe(false);
    for (const name of ["Acme.io Mail", "Admin", "A", "...", "word ".repeat(20), "x_y z-1"]) {
      expect([name, Schema.is(ProjectSlug)(projectSlugFromName(name))]).toEqual([name, true]);
    }
  });
});
