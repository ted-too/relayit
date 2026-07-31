import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/admin/projects")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_authd/admin/projects"!</div>;
}
