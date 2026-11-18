/**
 * Requests to a URL a customer named: a hosted attachment's `path`, a Webhook Endpoint's
 * URL. Such a URL must not reach anything a stranger on the internet couldn't: only
 * `https:`, only to a host whose every address is public, with the request sent to the
 * address that was checked, and no redirect followed.
 */
import * as NodeDnsPromises from "node:dns/promises";
import * as NodeNet from "node:net";
import { Context, Data, Effect, Predicate } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import ipaddr from "ipaddr.js";

/**
 * Every address a host resolves to. Real DNS unless a test replaces it; it is read from
 * the Effect context, never from a request or the database, so only code can replace it.
 */
export const PublicHostLookup = Context.Reference<{
  readonly resolve: (hostname: string) => Promise<readonly string[]>;
}>("PublicUrl/PublicHostLookup", {
  defaultValue: () => ({
    resolve: async (hostname) =>
      (await NodeDnsPromises.lookup(hostname, { all: true, verbatim: true })).map(
        (entry) => entry.address,
      ),
  }),
});

/**
 * A URL that may not be requested. `no_public_address` carries the `host` and whether its
 * name `resolved` at all, for the log: callers answer the two alike, so a customer can't
 * learn which internal names Relayit's resolver knows.
 */
export class PublicUrlRefused extends Data.TaggedError("PublicUrlRefused")<{
  readonly host?: string;
  readonly reason: "hostname_too_long" | "no_public_address" | "unsupported_url";
  readonly resolved?: boolean;
}> {
  override readonly message = "URL is not an https URL of a public host";
}

/** A DNS failure other than "no such name": Relayit's, not the URL's. */
export class PublicHostLookupFailed extends Data.TaggedError("PublicHostLookupFailed")<{
  readonly cause: unknown;
}> {
  override readonly message = "Host lookup failed";
}

// The longest name DNS can hold. The URL parser takes any length, and a longer one would
// be looked up and logged whole.
const MAX_HOSTNAME_LENGTH = 253;

// IPv6 global unicast; everything outside it (loopback, IPv4-compatible `::/96`,
// unique-local, link-local, multicast) is refused whatever its `range()`.
const GLOBAL_UNICAST_V6 = ipaddr.parseCIDR("2000::/3");

// Only plain public unicast. Loopback, private, link-local, unique-local, CGNAT,
// unspecified, multicast, reserved and the IPv6 ranges that embed an IPv4 address
// (6to4, NAT64, Teredo) all have another `range()`; an IPv4-mapped IPv6 address
// is judged as the IPv4 address it maps.
const isPublic = (address: string) => {
  const ip = ipaddr.process(address);
  return ip.range() === "unicast" && (ip.kind() === "ipv4" || ip.match(GLOBAL_UNICAST_V6));
};

/**
 * What can be told of a URL without a lookup: it parses, it is `https:`, its hostname
 * could exist, and a literal address in it is public. Enough to refuse a URL when it is
 * saved; `requestPublicUrl` checks it again, and what the name resolves to, when it is used.
 */
export const checkPublicUrl = (url: string) =>
  Effect.suspend(() => {
    const parsed = URL.parse(url);
    if (parsed?.protocol !== "https:") {
      return Effect.fail(new PublicUrlRefused({ reason: "unsupported_url" }));
    }
    // The URL parser has already normalised IPv4 spellings; IPv6 keeps its brackets.
    const hostname = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
    if (hostname.length > MAX_HOSTNAME_LENGTH) {
      return Effect.fail(new PublicUrlRefused({ reason: "hostname_too_long" }));
    }
    const literal = NodeNet.isIP(hostname) !== 0;
    if (literal && !isPublic(hostname)) {
      return Effect.fail(
        new PublicUrlRefused({ host: parsed.host, reason: "no_public_address", resolved: true }),
      );
    }
    return Effect.succeed({ hostname, literal, parsed });
  });

/**
 * The response to `request(url)`, sent to a public address of the URL's host. The host is
 * resolved once and every address checked, one non-public address among them refusing the
 * URL; the request goes to those addresses, each in turn until one gives a response, with
 * the hostname as `Host` and as the TLS server name the certificate is checked against, so
 * another DNS answer can't steer it elsewhere. A redirect is not followed: the caller sees
 * the 3xx. The client is built here, with its own `RequestInit`, rather than taken from
 * the caller; only the `fetch` function it calls comes from the context
 * (`FetchHttpClient.Fetch`), as a test's fake does.
 */
export const requestPublicUrl = (
  url: string,
  request: (pinned: URL) => HttpClientRequest.HttpClientRequest,
) =>
  checkPublicUrl(url).pipe(
    Effect.flatMap(({ hostname, literal, parsed }) =>
      Effect.gen(function* () {
        const lookup = yield* PublicHostLookup;
        const addresses = literal
          ? [hostname]
          : yield* Effect.tryPromise({
              catch: (cause) => new PublicHostLookupFailed({ cause }),
              // A name with no address has no public one, and is refused as such below.
              try: () =>
                lookup.resolve(hostname).catch((cause: unknown) => {
                  switch (Predicate.hasProperty(cause, "code") ? cause.code : undefined) {
                    case "ENODATA":
                    case "ENOTFOUND":
                      return [];
                    default:
                      throw cause;
                  }
                }),
            });
        if (addresses.length === 0 || !addresses.every(isPublic)) {
          return yield* new PublicUrlRefused({
            host: parsed.host,
            reason: "no_public_address",
            resolved: addresses.length > 0,
          });
        }

        const http = yield* HttpClient.HttpClient;
        // `execute` fails only before a response arrives, so the next address is tried
        // only when this one gave none.
        return yield* Effect.firstSuccessOf(
          addresses.map((address) => {
            const pinned = new URL(parsed);
            pinned.hostname = NodeNet.isIP(address) === 6 ? `[${address}]` : address;
            return http.execute(
              request(pinned).pipe(HttpClientRequest.setHeader("host", parsed.host)),
            );
          }),
        );
      }).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, {
          redirect: "manual",
          ...(literal ? {} : { tls: { serverName: hostname } }),
        } satisfies BunFetchRequestInit),
        Effect.provide(FetchHttpClient.layer),
      ),
    ),
  );
