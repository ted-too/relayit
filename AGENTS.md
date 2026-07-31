## Agent skills

### Issue tracker

GitHub Issues on `ted-too/relayit`; external PRs are also a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context — `CONTEXT-MAP.md` at the root points at per-context docs. See `docs/agents/domain.md`.

### Drizzle migrations

Never hand-edit `apps/api/drizzle/`. Schema TS → `bun run db:generate`; if generate needs a TTY, ask a human. See `docs/agents/drizzle-migrations.md`.
