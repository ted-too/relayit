#!/usr/bin/env bash
# Drops the databases worktree-setup.sh made for worktrees that no longer exist, and clears
# those worktrees' Redis keys (wt:<worktree>:*). Only databases it marked are considered,
# so nothing else on that Postgres or Redis is touched. Run it after removing worktrees;
# `--dry-run` lists what it would do.
set -euo pipefail

SERVER="${WORKTREE_POSTGRES_URL:-postgres://postgres:postgres@localhost:5433}"
REDIS="${WORKTREE_REDIS_URL:-redis://localhost:6379}"

LIVE="$(git worktree list --porcelain | sed -n 's/^worktree //p')" \
  DRY_RUN="${1:-}" SERVER="$SERVER" REDIS="$REDIS" bun --no-env-file run - <<'EOF'
import * as NodeFS from "node:fs";

// A worktree whose directory was deleted without `git worktree remove` is still listed.
const live = new Set(process.env.LIVE.split("\n").filter((path) => NodeFS.existsSync(path)));
const dryRun = process.env.DRY_RUN === "--dry-run";
const sql = new Bun.SQL(`${process.env.SERVER}/postgres`);
const marked = await sql`
  select datname, shobj_description(oid, 'pg_database') as comment
  from pg_database
  where datname like 'relayit\_wt\_%'
    and shobj_description(oid, 'pg_database') like 'worktree:%'`;
const stale = marked.filter((db) => !live.has(db.comment.slice("worktree:".length)));
const redis = new Bun.RedisClient(process.env.REDIS);
for (const db of stale) {
  const prefix = `wt:${db.datname.slice("relayit_wt_".length)}:`;
  let cursor = "0";
  const keys = [];
  do {
    const [next, batch] = await redis.send("SCAN", [cursor, "MATCH", `${prefix}*`, "COUNT", "500"]);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  if (dryRun) {
    console.log(`would drop ${db.datname} and ${keys.length} Redis keys under ${prefix} (${db.comment})`);
    continue;
  }
  await sql.unsafe(`drop database "${db.datname}" with (force)`);
  for (let start = 0; start < keys.length; start += 500) {
    await redis.send("UNLINK", keys.slice(start, start + 500));
  }
  console.log(`dropped ${db.datname} and ${keys.length} Redis keys under ${prefix} (${db.comment})`);
}
if (stale.length === 0) console.log("No databases of removed worktrees.");
redis.close();
await sql.end();
EOF
