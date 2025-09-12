import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/$projectSlug/templates")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_authd/$projectSlug/templates"!</div>;
}
