import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → Message / Campaign Send Attachments).
 * Product language: shared/messages/CONTEXT.md (Attachment).
 * Limits may be Plan-governed; exact knobs can stay Plan-level.
 */
describe("Attachment on Message", () => {
  it.todo(
    "associates Attachment metadata + content reference with a Message at create time"
  );

  it.todo("includes Attachments on email Deliveries of that Message");

  it.todo(
    "channels that do not support attachments ignore or reject per channel rules"
  );
});

describe("Attachment on Campaign Send", () => {
  it.todo(
    "shares the same underlying Attachment content across fan-out Messages (not one copy per recipient)"
  );
});

describe("Attachment limits", () => {
  it.todo(
    "rejects Attachments that exceed Plan size and/or count limits when those limits apply"
  );

  it.todo("rejects blocked/unsafe attachment types before Provider handoff");
});
