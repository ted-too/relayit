import {
  type TemplatingBuilderRpcClient,
  withTemplatingBuilderClient,
} from "@repo/templating";
import { Effect, Redacted } from "effect";
import { env } from "@/env";

/** Require builder URL + secret; open a scoped Rpc client for one call. */
export const runTemplatingBuilder = <A, E>(
  use: (client: TemplatingBuilderRpcClient) => Effect.Effect<A, E>
): Promise<A> => {
  const url = env.TEMPLATING_BUILDER_URL;
  const secret = env.TEMPLATING_BUILDER_SECRET;
  if (!(url && secret)) {
    return Promise.reject(
      new Error(
        "Template builder is not configured. Set TEMPLATING_BUILDER_URL and TEMPLATING_BUILDER_SECRET."
      )
    );
  }

  return Effect.runPromise(
    withTemplatingBuilderClient(
      {
        secret: Redacted.make(secret),
        url,
      },
      use
    ).pipe(
      Effect.mapError((error) => {
        if (
          error &&
          typeof error === "object" &&
          "message" in error &&
          typeof (error as { message: unknown }).message === "string"
        ) {
          return new Error((error as { message: string }).message);
        }
        return new Error("Template builder request failed.");
      })
    )
  );
};
