/**
 * Parent `Domain` for Better Auth `crossSubDomainCookies`.
 *
 * Returns the shared parent (e.g. `relayit.io`) when the given absolute URLs
 * span different hostnames that share a ≥2-label suffix. No leading dot —
 * Better Auth / modern browsers treat `Domain=relayit.io` as covering
 * subdomains. Returns `undefined` when every hostname matches (host-only
 * cookies are enough) or when there is no shared parent.
 */
export function sharedCookieDomain(
  ...absoluteUrls: string[]
): string | undefined {
  if (absoluteUrls.length === 0) {
    return;
  }

  const hostnames = [
    ...new Set(
      absoluteUrls.map((url) => new URL(url).hostname.toLowerCase())
    ),
  ];

  if (hostnames.length === 1) {
    return;
  }

  const labelLists = hostnames.map((hostname) => hostname.split("."));
  const sharedLabels: string[] = [];
  const maxShared = Math.min(...labelLists.map((labels) => labels.length));

  for (let offset = 1; offset <= maxShared; offset += 1) {
    const label = labelLists[0]?.at(-offset);
    if (
      label === undefined ||
      !labelLists.every((labels) => labels.at(-offset) === label)
    ) {
      break;
    }
    sharedLabels.unshift(label);
  }

  if (sharedLabels.length < 2) {
    return;
  }

  return sharedLabels.join(".");
}
