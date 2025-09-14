import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/$projectSlug/settings/team")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_authd/$projectSlug/settings/team"!</div>;
}
