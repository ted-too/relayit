import { createFileRoute } from "@tanstack/react-router";

// The page a person lands on from an unsubscribe link. A mailbox provider's one-click POST
// to the same URL is the api's (`apps/api/src/routes/unsubscribe.ts`).
export const Route = createFileRoute("/unsubscribe/$orgSlug/$contactId")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/unsubscribe/$orgSlug/$contactId"!</div>;
}
