# Process-first API `src/` layout

## Status

Superseded by [ADR-0009](./0009-four-deployable-topology.md)

`apps/api/src` is organized by deployable process first (`server/`, `worker/`, `shared/`), not by domain at the top level. Domain contexts (tenancy, messages, contacts, channels, …) and platform infra (db, queue, …) live under `shared/`. HTTP/auth wiring stays in `server/`; queue bootstrap and registries stay in `worker/`. Import direction is process → shared only (never process↔process or shared→process). We chose this over a domain-first top level so process boundaries stay obvious and shared domain code cannot accidentally depend on HTTP or worker singletons; domain locality is preserved one level down under `shared/`.

This ADR remains an accurate description of the legacy API layout while the
four deployables are extracted. New work follows ADR-0009.
