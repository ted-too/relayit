import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authd/$orgSlug/settings/integrations')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authd/$orgSlug/settings/integrations"!</div>
}
