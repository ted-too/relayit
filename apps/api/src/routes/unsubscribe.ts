import { handleListUnsubscribeOneClick } from "@repo/channels/email/deliverability";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

// What `Response.json` answered with on the dashboard's server, where this route was.
const JSON_TYPE = "application/json;charset=utf-8";

/**
 * One-click unsubscribe (RFC 8058): the POST a mailbox provider sends to the
 * `List-Unsubscribe` URL in marketing mail, without cookies or JavaScript. The URL is in
 * mail already delivered, so its path and query (`msg`, `topic`, `sig`) are fixed. A GET
 * of the same path is the dashboard's page. `handle` is the real one unless a test swaps it.
 */
export const unsubscribeRoutes = (options: {
  readonly handle?: typeof handleListUnsubscribeOneClick;
  /** The current better-auth secret, which signed the link. */
  readonly secret: string;
}) =>
  HttpRouter.add("POST", "/unsubscribe/:orgSlug/:contactId", (request) =>
    Effect.gen(function* () {
      const { contactId, orgSlug } = yield* HttpRouter.params;
      const url = HttpServerRequest.toURL(request);
      const query = {
        messageId: url._tag === "Some" ? (url.value.searchParams.get("msg") ?? "") : "",
        signature: url._tag === "Some" ? (url.value.searchParams.get("sig") ?? "") : "",
        topicId: url._tag === "Some" ? (url.value.searchParams.get("topic") ?? "") : "",
      };
      if (!(orgSlug && contactId && query.messageId && query.signature && query.topicId)) {
        return HttpServerResponse.jsonUnsafe(
          { code: "bad_request", message: "msg, topic, and sig query params are required" },
          { contentType: JSON_TYPE, status: 400 },
        );
      }
      return yield* (options.handle ?? handleListUnsubscribeOneClick)({
        contactId,
        messageId: query.messageId,
        orgSlug,
        secret: options.secret,
        signature: query.signature,
        topicId: query.topicId,
      }).pipe(
        Effect.map((result) => HttpServerResponse.jsonUnsafe(result, { contentType: JSON_TYPE })),
        Effect.catch((error) => {
          switch (error.code) {
            case "bad_request":
            case "invalid_signature":
              return Effect.succeed(
                HttpServerResponse.jsonUnsafe(
                  { code: error.code, message: error.message },
                  { contentType: JSON_TYPE, status: 400 },
                ),
              );
            case "not_found":
              return Effect.succeed(
                HttpServerResponse.jsonUnsafe(
                  { code: error.code, message: error.message },
                  { contentType: JSON_TYPE, status: 404 },
                ),
              );
            default:
              return Effect.die(error);
          }
        }),
      );
    }),
  );
