import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/user/account")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_authd/user/account"!</div>;
}
