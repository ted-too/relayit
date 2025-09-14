import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/$projectSlug/contacts")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_authd/$projectSlug/contacts"!</div>;
}
