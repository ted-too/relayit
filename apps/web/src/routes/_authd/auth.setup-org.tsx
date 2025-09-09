import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/auth/setup-org")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_authd/auth/setup-org"!</div>;
}
