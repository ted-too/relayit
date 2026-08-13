import { describe, expect, test } from "bun:test";
import { slugify } from "./slug";

describe("slugify", () => {
  test("lowercases and kebab-cases free text", () => {
    expect(slugify("Daily Journal")).toBe("daily-journal");
  });

  test("strips punctuation", () => {
    expect(slugify("  Red / Blue Cover!! ")).toBe("red-blue-cover");
  });

  test("returns empty for whitespace-only input", () => {
    expect(slugify("   ")).toBe("");
    expect(slugify("---")).toBe("");
  });
});
