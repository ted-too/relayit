# Drizzle migrations

Schema source of truth: `apps/api/src/shared/db/schema/`.

## Agent rules

1. **Do not hand-edit** anything under `apps/api/drizzle/` (migration SQL, snapshots, journal).
2. Change schema TS only, then generate:
   ```bash
   cd apps/api && bun run db:generate
   ```
3. If generate is **interactive** (rename vs create prompts) or fails for lack of a TTY, **ask a human** to run it in their terminal. Do not pipe fake keypresses or invent migration files.
4. Migrate when asked:
   ```bash
   cd apps/api && bun run db:migrate
   ```

## Why

Drizzle’s journal + snapshots must stay consistent with `drizzle-kit`. Hand-patched migrations drift and break future generates.
