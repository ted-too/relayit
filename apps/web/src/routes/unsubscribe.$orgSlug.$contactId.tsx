import { createFileRoute } from "@tanstack/react-router";
import { proxyToApi } from "@/lib/api-proxy";

export const Route = createFileRoute("/unsubscribe/$orgSlug/$contactId")({
  server: {
    handlers: {
      // One-click unsubscribe from a mailbox provider; the api records it.
      POST: ({ request }) => proxyToApi(request),
    },
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/unsubscribe/$orgSlug/$contactId"!</div>;
}
