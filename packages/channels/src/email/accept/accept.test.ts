import { describe, expect, test } from "bun:test";
import { Jobs, type JobsService } from "@repo/jobs";
import { ObjectStorage, type ObjectStorageService } from "@repo/object-storage";
import { DB } from "@repo/persistence/db/effect";
import { DateTime, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";
import { Usage, type UsageService } from "../../usage";
import { acceptTransactionalEmail } from "./accept";

const unsupported = () => Effect.die("unused test service");
const testServices = Layer.mergeAll(
  Layer.succeed(DB, {} as Effect.Success<typeof DB>),
  Layer.succeed(Jobs, {
    cancel: unsupported,
    enqueue: unsupported,
    schedule: unsupported,
  } satisfies JobsService),
  Layer.succeed(ObjectStorage, {
    delete: unsupported,
    download: unsupported,
    exists: unsupported,
    signedDownloadUrl: unsupported,
    signedUploadUrl: unsupported,
    upload: unsupported,
  } satisfies ObjectStorageService),
  Layer.succeed(Usage, {
    confirm: unsupported,
    release: unsupported,
    remeter: unsupported,
    reserve: unsupported,
  } satisfies UsageService),
  Layer.succeed(
    HttpClient.HttpClient,
    {} as Effect.Success<typeof HttpClient.HttpClient>
  )
);

const baseInput = {
  attribution: { kind: "project" as const },
  organizationId: "org_test",
  scheduledAt: DateTime.makeUnsafe("2026-08-10T00:00:00.000Z"),
};

describe("acceptTransactionalEmail", () => {
  test("rejects a Message without recipients before using infrastructure", () =>
    Effect.runPromise(
      acceptTransactionalEmail({
        ...baseInput,
        email: {
          attachments: [],
          bcc: [],
          cc: [],
          content: {
            html: "<p>Hello</p>",
            kind: "inline",
            subject: "Hello",
          },
          from: {
            address: "sender@example.com",
            normalized: "sender@example.com",
          },
          headers: {},
          replyTo: [],
          to: [],
        },
      }).pipe(
        Effect.provide(testServices),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            _tag: "EmailAcceptRejected",
            code: "no_recipients",
          });
          return error;
        })
      )
    ));

  test("rejects blocked attachment filenames before using infrastructure", () =>
    Effect.runPromise(
      acceptTransactionalEmail({
        ...baseInput,
        email: {
          attachments: [
            {
              filename: "payload.exe",
              source: { content: "QQ==", kind: "base64" },
            },
          ],
          bcc: [],
          cc: [],
          content: {
            html: "<p>Hello</p>",
            kind: "inline",
            subject: "Hello",
          },
          from: {
            address: "sender@example.com",
            normalized: "sender@example.com",
          },
          headers: {},
          replyTo: [],
          to: [{ email: "recipient@example.com" }],
        },
      }).pipe(
        Effect.provide(testServices),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            _tag: "EmailAcceptRejected",
            code: "invalid_attachment",
            details: {
              filename: "payload.exe",
              reason: "blocked_extension",
            },
            message: "This file type isn't allowed for security reasons.",
          });
          return error;
        })
      )
    ));
});
