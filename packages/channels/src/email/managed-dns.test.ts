import { describe, expect, test } from "bun:test";
import { formatTxtRecordContent } from "./managed-dns";

describe("formatTxtRecordContent", () => {
  test("wraps bare TXT values in quotes", () => {
    expect(formatTxtRecordContent("v=spf1 include:amazonses.com ~all")).toBe(
      '"v=spf1 include:amazonses.com ~all"'
    );
  });

  test("leaves already-quoted values alone", () => {
    expect(formatTxtRecordContent('"v=spf1 ~all"')).toBe('"v=spf1 ~all"');
  });
});
