import { createFileRoute } from "@tanstack/react-router";
import { proxyToApi } from "@/lib/api-proxy";

// better-auth (`/api/auth/*`) and the dashboard's operations (`/api/dashboard/*`) are the
// api's.
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      DELETE: ({ request }) => proxyToApi(request),
      GET: ({ request }) => proxyToApi(request),
      PATCH: ({ request }) => proxyToApi(request),
      POST: ({ request }) => proxyToApi(request),
      PUT: ({ request }) => proxyToApi(request),
    },
  },
});
