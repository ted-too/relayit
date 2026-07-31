import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/$orgSlug/automations/workflows")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div data-slot="balanced-outlet">Hello "/_authd/$orgSlug/workflows"!</div>
  );
}
