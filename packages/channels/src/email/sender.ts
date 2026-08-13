/**
 * Fixed local part every org sends from on a shared sandbox root (e.g.
 * `sandbox@relayit.fyi`). We verify the root domain, not per-org addresses, so
 * the local part is a platform constant rather than a stored column.
 */
export const SANDBOX_FROM_LOCAL_PART = "sandbox";

export type ResolvedEmailSender =
  | { readonly customDomainId: string; readonly kind: "custom" }
  | { readonly kind: "sandbox"; readonly sandboxDomainId: string };
