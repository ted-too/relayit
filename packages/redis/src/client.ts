import { RedisClient, type RedisOptions } from "bun";

/**
 * Bun's `RedisClient` reconnects with exponential backoff, but once
 * `maxRetries` is exhausted (or the connect promise fails) the instance is
 * permanently failed: every later command rejects with
 * `ERR_REDIS_CONNECTION_CLOSED` and nothing short of a new instance recovers.
 * A managed Redis restart (image upgrade, failover) routinely outlasts that
 * window, so the wrapper below swaps in a fresh client the first time a
 * command fails for connection reasons and replays the command once.
 */

export interface RedisReconnectEvent {
  readonly cause: unknown;
  /** Bun error code, e.g. `ERR_REDIS_CONNECTION_CLOSED`. Non-enumerable on the cause, so surfaced here for logs. */
  readonly code: string | undefined;
  readonly command: string;
}

/** Command surface the Effect layer and better-auth storage depend on. */
export interface RedisCommandClient {
  readonly close: () => void;
  readonly send: (command: string, args: string[]) => Promise<unknown>;
}

export interface RedisClientConfig {
  readonly onReconnect?: (event: RedisReconnectEvent) => void;
  /** Underlying client factory; only overridden by tests. */
  readonly open?: (url: string, options: RedisOptions) => RedisCommandClient;
  readonly options?: RedisOptions;
  readonly url: string;
}

const CONNECTION_ERROR_CODES: ReadonlySet<string> = new Set([
  "ERR_REDIS_CONNECTION_CLOSED",
  "ERR_REDIS_CONNECTION_TIMEOUT",
]);

const CONNECTION_ERROR_MESSAGE = /connection (?:has failed|closed|timeout)/i;

const errorCode = (error: unknown): string | undefined => {
  const code = (error as { readonly code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
};

export const isRedisConnectionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = errorCode(error);
  if (code !== undefined) {
    return CONNECTION_ERROR_CODES.has(code);
  }
  return CONNECTION_ERROR_MESSAGE.test(error.message);
};

/**
 * Keep Bun's own backoff short: it only needs to absorb brief blips. Anything
 * longer is handled by replacing the client, which fails fast for callers
 * while Redis is down and recovers on the first command once it is back.
 */
const DEFAULT_OPTIONS = {
  autoReconnect: true,
  connectionTimeout: 10_000,
  enableAutoPipelining: true,
  enableOfflineQueue: true,
  maxRetries: 10,
} satisfies RedisOptions;

const openBunClient = (url: string, options: RedisOptions) =>
  new RedisClient(url, options);

export const makeRedisClient = ({
  onReconnect,
  open = openBunClient,
  options,
  url,
}: RedisClientConfig): RedisCommandClient => {
  const openClient = () => open(url, { ...DEFAULT_OPTIONS, ...options });
  let current = openClient();
  let closed = false;

  const replace = (failed: RedisCommandClient, event: RedisReconnectEvent) => {
    if (current !== failed) {
      // A concurrent command already swapped the client; reuse it.
      return current;
    }
    failed.close();
    current = openClient();
    onReconnect?.(event);
    return current;
  };

  return {
    close: () => {
      closed = true;
      current.close();
    },
    send: async (command, args) => {
      const client = current;
      try {
        return await client.send(command, args);
      } catch (error) {
        if (closed || !isRedisConnectionError(error)) {
          throw error;
        }
        const next = replace(client, {
          cause: error,
          code: errorCode(error),
          command,
        });
        return await next.send(command, args);
      }
    },
  };
};
