import type { EmailProviderRegistry } from "@repo/channels/email/provider-registry";
import type { Usage } from "@repo/channels/usage";
import type { Jobs } from "@repo/jobs";
import type { ObjectStorage } from "@repo/object-storage";
import type { DB } from "@repo/persistence/db/effect";
import type { Effect } from "effect";
import type { HttpClient } from "effect/unstable/http";

export type ApiServices =
  | DB
  | EmailProviderRegistry
  | HttpClient.HttpClient
  | Jobs
  | ObjectStorage
  | Usage;

export type RunApiEffect = <Success, Error>(
  effect: Effect.Effect<Success, Error, ApiServices>,
  options?: { readonly signal?: AbortSignal }
) => Promise<Success>;
