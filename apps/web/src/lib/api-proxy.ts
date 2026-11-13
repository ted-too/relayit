/**
 * Forwards a request to the api, so better-auth's cookies and the dashboard's operations
 * stay on the dashboard's origin. `API_URL` is where this server reaches the api.
 */
export const proxyToApi = async (request: Request) => {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    return new Response("API_URL is not set", { status: 502 });
  }
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  const response = await fetch(new URL(`${url.pathname}${url.search}`, apiUrl), {
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    // @ts-expect-error -- Bun and Node stream a request body only half-duplex.
    duplex: "half",
    headers,
    method: request.method,
    // OAuth and Stripe redirects are the browser's to follow.
    redirect: "manual",
  });
  // fetch has already decoded the body; its length and encoding no longer apply.
  const forwarded = new Headers(response.headers);
  forwarded.delete("content-encoding");
  forwarded.delete("content-length");
  return new Response(response.body, {
    headers: forwarded,
    status: response.status,
    statusText: response.statusText,
  });
};
