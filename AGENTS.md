# Agent instructions

## Database migrations

**Never write Drizzle migration SQL files manually** unless the user explicitly asks you to.

When schema changes need a migration:

1. Update the Drizzle schema in `apps/api/src/db/schema/`.
2. Ask the user to run `bun run db:generate` in `apps/api`, or ask for explicit permission to write the migration by hand.
3. If `drizzle-kit generate` fails in your environment (non-interactive TTY, CI, etc.), **stop and ask the user** — do not substitute a hand-written migration.

The user-generated migration in `apps/api/drizzle/` is the source of truth.

### Running migrations

Migrations are applied automatically when the API starts via `bun dev` in `apps/api` (see `apps/api/src/index.ts`). **Do not run migrations manually to verify schema changes** — restart or start the dev server and confirm it boots cleanly.

If you need to run `db:migrate` or `db:generate` explicitly and hit a `Bun is not defined` error from drizzle-kit, use the Bun runtime explicitly:

```bash
cd apps/api && bun --bun run db:migrate
cd apps/api && bun --bun run db:generate
```

If a generated migration fails at startup, report the error to the user and ask them to regenerate or grant permission to patch the migration file — do not rewrite migrations from scratch.

## Code style

**Do not introduce unnecessary thin helper functions.** One-liners that only wrap a literal, re-export a type, or save a few characters bloat the codebase. Logic used in one place belongs inline in that function — do not split it into private helpers preemptively. Extract a helper only when the same non-trivial logic is reused in multiple call sites, or when a test truly needs it in isolation.

Prefer raw inline TypeScript (discriminated unions, `switch`/`if` narrowing, spread at call sites). Module-level constants for static data (lookup tables, regexes, config arrays) are fine; gratuitous `function` wrappers around them are not.
