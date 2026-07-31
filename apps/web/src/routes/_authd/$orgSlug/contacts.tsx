import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/$orgSlug/contacts")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div data-slot="balanced-outlet">Hello "/_authd/$orgSlug/contacts"!</div>
  );
}
