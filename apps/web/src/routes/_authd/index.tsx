import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authd/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authd/"!</div>
}
