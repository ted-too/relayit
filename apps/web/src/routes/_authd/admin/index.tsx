import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/admin/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_authd/admin/"!</div>;
}
