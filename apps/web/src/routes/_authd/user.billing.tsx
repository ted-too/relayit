import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authd/user/billing')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authd/user/billing"!</div>
}
