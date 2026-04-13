import { SidebarProvider } from "@repo/ui/components/ui/shad/sidebar";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { queries } from "@/integrations/queries";

export function AppSidebar({ children }: { children: React.ReactNode }) {
  const { data } = useSuspenseQuery(queries.auth.session.me);
  const { sidebarOpen } = useRouteContext({
    from: "/_authd",
  });

  if (!data?.user) {
    return null;
  }
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>{children}</SidebarProvider>
  );
}
