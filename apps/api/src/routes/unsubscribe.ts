import { handleListUnsubscribeOneClick } from "@repo/channels/email/deliverability";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

// What `Response.json` answered with on the dashboard's server, where this route was.
const JSON_TYPE = "application/json;charset=utf-8";

const PATH = "/unsubscribe/:orgSlug/:contactId";

/**
 * Unsubscribe from a Topic through the `List-Unsubscribe` URL the worker puts in marketing
 * mail, on the api's origin. A POST is RFC 8058's one-click unsubscribe, which a mailbox
 * provider sends without cookies or JavaScript; the dashboard's unsubscribe page sends the
 * same POST when a person confirms. A GET is a person opening the link, and is sent to that
 * page on `appOrigin` with the same path and query: a GET never unsubscribes, since link
 * scanners fetch every URL in a message. The query (`msg`, `topic`, `sig`) is in mail
 * already delivered, so it is fixed. `handle` is the real one unless a test swaps it.
 */
export const unsubscribeRoutes = (options: {
  readonly appOrigin: string;
  readonly handle?: typeof handleListUnsubscribeOneClick;
  /** The current better-auth secret, which signed the link. */
  readonly secret: string;
}) =>
  Layer.mergeAll(
    HttpRouter.add("GET", PATH, (request) =>
      Effect.succeed(HttpServerResponse.redirect(`${options.appOrigin}${request.url}`)),
    ),
    HttpRouter.add("POST", PATH, (request) =>
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
    ),
  );
