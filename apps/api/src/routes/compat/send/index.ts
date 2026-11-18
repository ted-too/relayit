import { acceptTransactionalEmail } from "@repo/channels/email/accept";
import { logEffectFailure } from "@repo/logging";
import { Cause, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  Api,
  LegacyLimitExceeded,
  LegacyProject,
  LegacyRefused,
  LegacyServerError,
} from "../../../api";
import { ApiAuth } from "../../../lib/auth";
import {
  type LegacyMapResult,
  mapLegacyRawToAccept,
  mapLegacyTemplateToAccept,
  resolveLegacyDefaultFromAddress,
} from "./map";

/**
 * Temporary compat surface for apps still on prod Relayit send paths. Prefer
 * `POST /messages/email` for new integrations. `accept` is the one the api sends with,
 * unless a test swaps it.
 *
 * - `POST /send/:project/raw/email`
 * - `POST /send/:project/template/email`
 */
export const legacySendHandlers = (accept = acceptTransactionalEmail) =>
  HttpApiBuilder.group(
    Api,
    "legacySend",
    Effect.fn(function* (handlers) {
      const { db } = yield* ApiAuth;

      const send = (
        bodyFrom: string | undefined,
        map: (from: string | undefined, organizationId: string) => LegacyMapResult,
        failureMessage: string,
      ) =>
        Effect.gen(function* () {
          const project = yield* LegacyProject;
          const from =
            bodyFrom ??
            (yield* Effect.promise(() =>
              resolveLegacyDefaultFromAddress({ db, organizationId: project.id }),
            ));
          const mapped = map(from ?? undefined, project.id);
          if (!mapped.ok) {
            return yield* new LegacyRefused({ details: mapped.details, message: mapped.message });
          }

          const accepted = yield* accept(mapped.input).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                switch (error._tag) {
                  case "EmailAcceptRejected":
                    return yield* new LegacyRefused({
                      details: [error.code],
                      message: error.message,
                    });
                  case "UsageLimitExceeded":
                    return yield* error.window === "daily"
                      ? new LegacyLimitExceeded({
                          details: ["daily_limit_exceeded"],
                          message: "Daily email send limit exceeded",
                        })
                      : new LegacyLimitExceeded({
                          details: ["monthly_limit_exceeded"],
                          message: "Monthly email send limit exceeded",
                        });
                  default:
                    yield* logEffectFailure(failureMessage)(Cause.fail(error));
                    return yield* new LegacyServerError({
                      details: [],
                      message: "Something went wrong",
                    });
                }
              }),
            ),
            Effect.annotateLogs({ organizationId: project.id }),
          );
          return { id: accepted.messageId, status: "queued" as const };
        });

      return handlers
        .handle("sendRawEmail", ({ payload: body }) =>
          send(
            body.from,
            (from, organizationId) => mapLegacyRawToAccept({ body, from, organizationId }),
            "Legacy raw send failed",
          ),
        )
        .handle("sendTemplateEmail", ({ payload: body }) =>
          send(
            body.from,
            (from, organizationId) => mapLegacyTemplateToAccept({ body, from, organizationId }),
            "Legacy template send failed",
          ),
        );
    }),
  );
