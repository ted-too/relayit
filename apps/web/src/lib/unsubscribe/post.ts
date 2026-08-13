import type { handleListUnsubscribeOneClick } from "@repo/channels/email/deliverability";
import { getCurrentBetterAuthSecret } from "@repo/persistence/crypto/auth-secrets";
import { Effect } from "effect";
import { env } from "@/env";
import { AppLive } from "@/lib/layers";

const unsubscribeQuery = (url: URL) => ({
  messageId: url.searchParams.get("msg") ?? "",
  signature: url.searchParams.get("sig") ?? "",
  topicId: url.searchParams.get("topic") ?? "",
});

export interface UnsubscribePostParams {
  readonly contactId: string;
  readonly orgSlug: string;
}

const mapUnsubscribeResult = <A, E extends { readonly code: string }, R>(
  effect: Effect.Effect<
    A,
    E & {
      readonly _tag: "ListUnsubscribeError";
      readonly code: "bad_request" | "invalid_signature" | "not_found";
      readonly message: string;
    },
    R
  >
) =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => {
        switch (error.code) {
          case "invalid_signature":
          case "bad_request":
            return Response.json(
              {
                code: error.code,
                message: error.message,
              },
              { status: 400 }
            );
          case "not_found":
            return Response.json(
              {
                code: error.code,
                message: error.message,
              },
              { status: 404 }
            );
          default: {
            const _exhaustive: never = error.code;
            return _exhaustive;
          }
        }
      },
      onSuccess: (payload) => Response.json(payload),
    })
  );

export const createUnsubscribePostHandler = (
  handle: typeof handleListUnsubscribeOneClick,
  options?: {
    readonly runEffect?: (effect: Effect.Effect<Response>) => Promise<Response>;
    readonly secret?: string;
  }
) => {
  const resolvedSecret =
    options?.secret ?? getCurrentBetterAuthSecret(env.BETTER_AUTH_SECRETS);

  return ({
    params,
    request,
  }: {
    readonly params: UnsubscribePostParams;
    readonly request: Request;
  }): Promise<Response> => {
    const query = unsubscribeQuery(new URL(request.url));

    if (!(query.messageId && query.signature && query.topicId)) {
      return Promise.resolve(
        Response.json(
          {
            code: "bad_request",
            message: "msg, topic, and sig query params are required",
          },
          { status: 400 }
        )
      );
    }

    const responseEffect = mapUnsubscribeResult(
      handle({
        contactId: params.contactId,
        messageId: query.messageId,
        orgSlug: params.orgSlug,
        secret: resolvedSecret,
        signature: query.signature,
        topicId: query.topicId,
      })
    );

    if (options?.runEffect) {
      return options.runEffect(responseEffect as Effect.Effect<Response>);
    }

    return Effect.runPromise(responseEffect.pipe(Effect.provide(AppLive)));
  };
};
