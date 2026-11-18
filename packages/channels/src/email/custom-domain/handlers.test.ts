import { describe, expect, it } from "@effect/vitest";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  EmailBackend,
  EmailBackendAuthenticationError,
  EmailBackendConfigurationError,
  type EmailBackendService,
  EmailBackendUnavailable,
} from "../backend";
import { emailDeleteDomainIdentityHandler } from "./handlers";

const unsupported = () => Effect.die("unused");

/** A database in which the FQDN is not registered again. */
const db: any = {
  transaction: (run: (tx: unknown) => Effect.Effect<unknown, unknown>) =>
    run({
      execute: () => Effect.void,
      select: () => ({
        from: () => ({ innerJoin: () => ({ where: () => Effect.succeed([]) }) }),
      }),
    }),
};

const deleteIdentity = (deleteIdentity: EmailBackendService["deleteIdentity"]) =>
  emailDeleteDomainIdentityHandler
    .handle(
      { fqdn: "acme.test", region: "eu-central-1" },
      { attempt: 1, enqueuedAt: 0, id: "job_1" },
    )
    .pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(DB, db),
          Layer.succeed(EmailBackend, {
            createIdentity: unsupported,
            defaultRegion: "eu-central-1",
            deleteIdentity,
            ensureInfrastructure: unsupported,
            getIdentityStatus: unsupported,
            getProjectSendingStatus: unsupported,
            send: unsupported,
          } satisfies EmailBackendService),
        ),
      ),
    );

describe("emailDeleteDomainIdentityHandler", () => {
  it.effect("gives up an SES call that never answers, to be retried", () =>
    Effect.gen(function* () {
      const running = yield* Effect.forkChild(Effect.flip(deleteIdentity(() => Effect.never)));
      yield* TestClock.adjust("30 seconds");
      const failure = yield* Fiber.join(running);

      expect(failure).toMatchObject({
        _tag: "DeleteDomainIdentityHandlerError",
        message: "SES did not answer in time while deleting the identity.",
      });
      expect(emailDeleteDomainIdentityHandler.classifyFailure(failure)).toBe("retryable");
    }),
  );

  it.effect("retries an outage and refused credentials, and stops on an unknown region", () =>
    Effect.gen(function* () {
      const outage = yield* Effect.flip(
        deleteIdentity(() => Effect.fail(new EmailBackendUnavailable({ region: "eu-central-1" }))),
      );
      expect(emailDeleteDomainIdentityHandler.classifyFailure(outage)).toBe("retryable");

      const refused = yield* Effect.flip(
        deleteIdentity(() =>
          Effect.fail(new EmailBackendAuthenticationError({ region: "eu-central-1" })),
        ),
      );
      expect(emailDeleteDomainIdentityHandler.classifyFailure(refused)).toBe("retryable");

      const unknownRegion = yield* Effect.flip(
        deleteIdentity(() =>
          Effect.fail(
            new EmailBackendConfigurationError({ code: "unknown_region", region: "eu-central-1" }),
          ),
        ),
      );
      expect(unknownRegion).toMatchObject({ _tag: "EmailBackendConfigurationError" });
      expect(emailDeleteDomainIdentityHandler.classifyFailure(unknownRegion)).toBe("terminal");
    }),
  );
});
