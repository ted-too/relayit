import { handleListUnsubscribeOneClick } from "@repo/channels/email/deliverability";
import { createFileRoute } from "@tanstack/react-router";
import { createUnsubscribePostHandler } from "@/lib/unsubscribe/post";

const postUnsubscribe = createUnsubscribePostHandler(
  handleListUnsubscribeOneClick
);

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
