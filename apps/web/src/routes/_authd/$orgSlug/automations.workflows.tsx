import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authd/$orgSlug/automations/workflows')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authd/$orgSlug/workflows"!</div>
}
