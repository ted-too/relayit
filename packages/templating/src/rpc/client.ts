import { Context, Effect, Layer, type Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import { makeBuilderAuthClientLayer } from "./auth";
import { TemplatingBuilderRpcs } from "./group";

const TRAILING_SLASH = /\/$/;

export type TemplatingBuilderRpcClient = RpcClient.FromGroup<
  typeof TemplatingBuilderRpcs,
  RpcClientError
>;

export class TemplatingBuilderClient extends Context.Service<
  TemplatingBuilderClient,
  TemplatingBuilderRpcClient
>()("TemplatingBuilderClient") {}

/**
 * Layers needed to call `apps/template-builder` over HTTP Effect Rpc.
 * No in-process fallback — URL + secret are required.
 */
export const makeTemplatingBuilderProtocolLive = (input: {
  readonly secret: Redacted.Redacted<string>;
  readonly url: string;
}) => {
  const rpcUrl = `${input.url.replace(TRAILING_SLASH, "")}/rpc`;
  return Layer.mergeAll(
    RpcClient.layerProtocolHttp({ url: rpcUrl }).pipe(
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(FetchHttpClient.layer)
    ),
    makeBuilderAuthClientLayer(input.secret)
  );
};

/** Scoped client service for use inside server fns / Effects. */
export const makeTemplatingBuilderClientLive = (input: {
  readonly secret: Redacted.Redacted<string>;
  readonly url: string;
}) =>
  Layer.effect(
    TemplatingBuilderClient,
    RpcClient.make(TemplatingBuilderRpcs)
  ).pipe(Layer.provide(makeTemplatingBuilderProtocolLive(input)));

/** One-shot helper: open a client, run `use`, dispose. */
export const withTemplatingBuilderClient = <A, E, R>(
  input: {
    readonly secret: Redacted.Redacted<string>;
    readonly url: string;
  },
  use: (client: TemplatingBuilderRpcClient) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(TemplatingBuilderRpcs);
      return yield* use(client);
    }).pipe(Effect.provide(makeTemplatingBuilderProtocolLive(input)))
  );
