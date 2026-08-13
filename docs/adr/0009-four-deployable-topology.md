# Combined backend runtime with queue-mediated work

## Status

Accepted

## Context

Relayit currently groups HTTP serving, background workers, and template building
under `apps/api`. Template building needs an independent deployment lifecycle,
while public ingress and background processing benefit from one operational
runtime during the package extraction.

The product needs browser-facing operations, public message ingress, background
delivery and infrastructure work, and template building. Web and API operations
can both produce jobs, but job production must not determine where those jobs
run. Existing clients and provider integrations must retain their ingress and
webhook URLs during the transition.

## Decision

Relayit will have three deployables over one PostgreSQL database:

- `apps/web` is the TanStack Start application. It owns Better Auth HTTP and
  session-authenticated user and configuration operations.
- `apps/api` is the combined backend runtime. One Effect composition root owns
  its Elysia HTTP server and worker fibers. Its HTTP surface keeps health,
  `POST /messages/email`, legacy `/send/*` compatibility, and provider webhook
  endpoints. Its worker executes message delivery, customer webhooks, and
  infrastructure jobs produced by either web or API.
- `apps/template-builder` is the internal template build process called only by web (Effect Rpc over the private network; shared-secret middleware; sole Git mutator).

Each deployable has its own validated `src/env.ts` and Effect composition root.
Deployables do not import another deployable's source. Shared behavior belongs
in narrowly owned packages imported through explicit source subpaths; pure
domain rules may remain plain TypeScript.

Work that crosses a process concern is represented by a typed job owned by its
domain package. Job contracts own retry and dead-letter policy. Routine
contracts own a stable payload identity and support scheduling, cancellation,
promotion, and reconciliation. Handlers are separate modules in
the same domain package. Producers in web or API import contracts and enqueue
or schedule work; only the API worker composition root imports and registers
handlers. HTTP request handlers do not perform asynchronous delivery or
infrastructure work directly.

Reusable job contracts, producer interfaces, and Redis worker mechanics belong
to a foundation package. A separate Redis foundation package owns the scoped
Bun-native clients and implements only the command surface Relayit uses.
Extracting these packages is a code seam, not a reason to run a worker in every
producing deployable.

All deployables share the existing PostgreSQL database and Effect database
layer during this migration. Packages may own their tables and persistence
adapters; the persistence Drizzle configuration aggregates those package-owned
schemas so migrations remain controlled by one release job. A package owning a
table does not create a separate connection pool.

## Consequences

- Public message ingress and provider webhook routes remain stable while their
  implementations move behind context seams.
- Session-authenticated management operations move to web server functions;
  the ingress API does not retain that surface.
- Queue contracts become durable, independently testable interfaces between
  web/API producers and the API-hosted worker.
- API request capacity and worker capacity scale together, and HTTP plus worker
  share a failure domain. This is an accepted operational trade-off.
- The combined runtime remains internally separable: HTTP adapters, worker
  mechanics, and domain handlers do not import one another's implementations.
- Deployables can start, configure, and deploy independently, while schema
  compatibility remains a coordinated release concern.
- ADR-0003 is superseded for the target topology. Its process-first layout
  remains descriptive of the legacy `apps/api/src` structure until the
  extraction is complete.
