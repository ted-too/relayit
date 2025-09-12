import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/$projectSlug/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_authd/$projectSlug/"!</div>;
}
