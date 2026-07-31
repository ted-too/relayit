import type { DbOrTx, Template } from "@repo/api/db";
import { describe, expect, it, vi } from "vitest";
import { isTemplateTypeId, resolveTemplateRef } from "./resolve";

function fakeDb(findFirst: ReturnType<typeof vi.fn>): DbOrTx {
  return {
    query: {
      template: { findFirst },
    },
  } as unknown as DbOrTx;
}

function templateRow(overrides: Partial<Template> = {}): Template {
  return {
    id: "tmpl_01ky60tepzexwvszypxkahb4rs",
    organizationId: "org_test",
    name: "Welcome email",
    slug: "welcome-email",
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("isTemplateTypeId", () => {
  it("recognizes tmpl_ typeids", () => {
    expect(isTemplateTypeId("tmpl_01ky60tepzexwvszypxkahb4rs")).toBe(true);
  });

  it("treats slugs as non-typeids", () => {
    expect(isTemplateTypeId("welcome-email")).toBe(false);
    expect(isTemplateTypeId("tmpl")).toBe(false);
  });
});

describe("resolveTemplateRef", () => {
  it("resolves by typeid when the ref looks like tmpl_…", async () => {
    const row = templateRow();
    const findFirst = vi.fn().mockResolvedValue(row);
    const result = await resolveTemplateRef({
      db: fakeDb(findFirst),
      organizationId: "org_test",
      idOrSlug: row.id,
    });

    expect(result).toEqual(row);
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it("resolves by slug when the ref is not a typeid", async () => {
    const row = templateRow({ slug: "order-confirmation" });
    const findFirst = vi.fn().mockResolvedValue(row);
    const result = await resolveTemplateRef({
      db: fakeDb(findFirst),
      organizationId: "org_test",
      idOrSlug: "order-confirmation",
    });

    expect(result).toEqual(row);
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it("returns null when no active Template matches", async () => {
    const findFirst = vi.fn().mockResolvedValue(undefined);
    const byId = await resolveTemplateRef({
      db: fakeDb(findFirst),
      organizationId: "org_other",
      idOrSlug: "tmpl_01ky60tepzexwvszypxkahb4rs",
    });
    const bySlug = await resolveTemplateRef({
      db: fakeDb(findFirst),
      organizationId: "org_test",
      idOrSlug: "archived-slug",
    });

    expect(byId).toBeNull();
    expect(bySlug).toBeNull();
  });
});
