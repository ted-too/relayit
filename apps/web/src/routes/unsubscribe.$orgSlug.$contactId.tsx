import { createFileRoute } from "@tanstack/react-router";
import { postUnsubscribe } from "@/lib/unsubscribe/post.server";

export const Route = createFileRoute("/unsubscribe/$orgSlug/$contactId")({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        postUnsubscribe({
          params: {
            contactId: params.contactId,
            orgSlug: params.orgSlug,
          },
          request,
        }),
    },
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/unsubscribe/$orgSlug/$contactId"!</div>;
}
