/**
 * Where to go once signed in: the `redirect` a page was given, path, query and hash, as long
 * as it stays on this origin. It comes from the URL, so anything that leaves the origin
 * (`https://other.test`, `//other.test`, `/\other.test`) goes home instead, and so does a
 * path that would leave it once used as a link: one that resolves here but whose pathname
 * starts `//` (`/.//other.test`), which a browser reads as another host.
 */
export const returnPath = (redirect: string | undefined, origin: string) => {
  if (!redirect) {
    return "/";
  }
  // `new URL` resolves `redirect` against this origin as a link on the page would, turning
  // each backslash into a slash; it only throws on a malformed absolute URL, which is no
  // path here either.
  try {
    const url = new URL(redirect, origin);
    return url.origin === origin && !url.pathname.startsWith("//")
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
};
