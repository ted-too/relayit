import { COOKIE_PREFIX } from "@repo/persistence/auth/constants";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

export interface Viewer {
  readonly email: string | null;
  readonly image: string | null;
  readonly name: string | null;
}

/** Matches `relayit.session_token=` and its `__Secure-` variant. */
const SESSION_COOKIE = new RegExp(
  `(?:^|;\\s*)(?:__Secure-)?${COOKIE_PREFIX}\\.session_token=[^;]+`
);

const SESSION_LOOKUP_TIMEOUT_MS = 1200;

const appUrl = () => process.env.APP_URL ?? "https://app.relayit.io";

/**
 * Who is looking at the marketing site.
 *
 * Better Auth lives in the dashboard app; with `AUTH_COOKIE_DOMAIN` set there,
 * its session cookie is scoped to the parent domain and reaches us too.
 * No cookie means signed out, with no network hop. With a cookie we ask the
 * dashboard's own `get-session` endpoint, so a revoked or expired session
 * reads as signed out. If the dashboard is slow or down we trust the cookie
 * (optimistic, like Better Auth's `getSessionCookie`) because the worst case
 * is a "Dashboard" link that lands on sign-in.
 */
const readViewer = async (): Promise<Viewer | null> => {
  const cookie = getRequestHeader("cookie");
  if (!(cookie && SESSION_COOKIE.test(cookie))) {
    return null;
  }

  try {
    const response = await fetch(new URL("/api/auth/get-session", appUrl()), {
      // Forward the raw header: cookie values stay exactly as signed.
      headers: { cookie },
      signal: AbortSignal.timeout(SESSION_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error("Session lookup failed");
    }
    const session = (await response.json()) as {
      user?: { email?: string; image?: string | null; name?: string };
    } | null;
    if (!session?.user) {
      return null;
    }
    return {
      email: session.user.email ?? null,
      image: session.user.image ?? null,
      name: session.user.name ?? null,
    };
  } catch {
    return { email: null, image: null, name: null };
  }
};

export const getSiteContext = createServerFn({ method: "GET" }).handler(
  async () => ({
    appUrl: appUrl(),
    viewer: await readViewer(),
  })
);
