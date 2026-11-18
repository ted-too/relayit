import { Context } from "effect";
import { detectDnsProvider } from "./custom-domain/provider-detection";
import { evaluateLiveDnsRecord } from "./verification/live-dns";

/**
 * Every public DNS query Domain setup makes: finding a Domain's DNS host, and checking its
 * records are published. Real lookups unless replaced; the fake email backend replaces
 * them, since a local Domain has no published records.
 */
export const DnsLookups = Context.Reference<{
  readonly detectProvider: typeof detectDnsProvider;
  readonly evaluate: typeof evaluateLiveDnsRecord;
}>("Channels/DnsLookups", {
  defaultValue: () => ({ detectProvider: detectDnsProvider, evaluate: evaluateLiveDnsRecord }),
});
