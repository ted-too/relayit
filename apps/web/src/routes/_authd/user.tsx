import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/user")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div>
      <div>All routes should have this</div>
      <Outlet />
    </div>
  );
}
