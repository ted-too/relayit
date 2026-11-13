#!/usr/bin/env bash
# Prepares a git worktree of this repo; T3 Code runs it when it creates one. Writes the
# worktree's root .env from .env.example with fresh secrets, its own database, its own
# block of ports and its own Redis key prefix, then installs, migrates and seeds. The .env
# is never copied from another checkout, so no real credential reaches a worktree.
# The databases live on the Postgres kept for worktrees (Ted's `postgres` container at
# localhost:5433); set WORKTREE_POSTGRES_URL to use another.
# Safe to run again: a worktree keeps the database, ports and prefix it was given.
# `--reset` drops and recreates its database and clears its Redis keys first, for a
# migration regenerated after a rebase.
set -euo pipefail
RESET="${1:-}"
SERVER="${WORKTREE_POSTGRES_URL:-postgres://postgres:postgres@localhost:5433}"

ROOT="$(git rev-parse --show-toplevel)"
MAIN="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
if [ "$ROOT" = "$MAIN" ]; then
  echo "This is the main checkout; worktree:setup changes nothing here. It keeps its own .env"
  echo "(docs/operations/development.md)."
  exit 0
fi

# Reads a variable from a .env file without sourcing it.
env_value() { sed -n "s/^$1=//p" "$2" | tail -1; }
listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

ENV="$ROOT/.env"
if [ ! -f "$ENV" ]; then
  NAME="$(basename "$ROOT" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9\n' '_')"

  # A block of four ports per checkout: web at the base, site +1, api +5, builder +6. The
  # main checkout has 3000; worktrees take the next block no other worktree has and nothing
  # listens on.
  taken=" 3000 "
  while read -r path; do
    [ "$path" != "$MAIN" ] && [ -f "$path/.env" ] && taken+="$(env_value WEB_PORT "$path/.env") "
  done < <(git worktree list --porcelain | sed -n 's/^worktree //p')
  BASE=3100
  while [[ "$taken" == *" $BASE "* ]] || listening "$BASE" || listening $((BASE + 1)) ||
    listening $((BASE + 5)) || listening $((BASE + 6)); do
    BASE=$((BASE + 100))
  done

  sed -E \
    -e "s|^WEB_PORT=.*|WEB_PORT=$BASE|" \
    -e "s|^SITE_PORT=.*|SITE_PORT=$((BASE + 1))|" \
    -e "s|^API_PORT=.*|API_PORT=$((BASE + 5))|" \
    -e "s|^BUILDER_PORT=.*|BUILDER_PORT=$((BASE + 6))|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=$SERVER/relayit_wt_$NAME|" \
    -e "s|^REDIS_KEY_PREFIX=.*|REDIS_KEY_PREFIX=wt:$NAME:|" \
    -e "s|^BETTER_AUTH_SECRETS=.*|BETTER_AUTH_SECRETS=1:$(openssl rand -hex 32)|" \
    -e "s|^TEMPLATING_BUILDER_SECRET=.*|TEMPLATING_BUILDER_SECRET=$(openssl rand -hex 32)|" \
    "$ROOT/.env.example" >"$ENV.tmp"
  mv "$ENV.tmp" "$ENV"
  echo "Wrote .env for this worktree from .env.example."
fi

DATABASE_URL="$(env_value DATABASE_URL "$ENV")"
REDIS_URL="$(env_value REDIS_URL "$ENV")"
REDIS_KEY_PREFIX="$(env_value REDIS_KEY_PREFIX "$ENV")"
if [[ "${DATABASE_URL##*/}" != relayit_wt_* || "$REDIS_KEY_PREFIX" != wt:* ]]; then
  echo ".env doesn't name a worktree database (relayit_wt_*) and Redis prefix (wt:*)." >&2
  echo "Move it aside and run this again to be given them." >&2
  exit 1
fi

# The comment marks the database as this worktree's, so worktree-prune.sh drops only these,
# whatever else that Postgres holds, and two worktrees with one name can't share one.
RESET="$RESET" WORKTREE="$ROOT" DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" \
  REDIS_KEY_PREFIX="$REDIS_KEY_PREFIX" bun --no-env-file run - <<'EOF'
const url = new URL(process.env.DATABASE_URL);
const name = url.pathname.slice(1);
const comment = `worktree:${process.env.WORKTREE}`;
url.pathname = "/postgres";
const sql = new Bun.SQL(url.href);
const [found] = await sql`
  select shobj_description(oid, 'pg_database') as comment from pg_database where datname = ${name}`.catch(
  (error) => {
    console.error(`No worktree Postgres at ${url.host}: ask Ted to start it ("Postgres 18").`);
    throw error;
  },
);
if (found && found.comment !== comment) {
  console.error(`${name} belongs to ${found.comment ?? "something else"}. If that worktree is`);
  console.error("gone, run bun run worktree:prune first; otherwise give this one another name.");
  process.exit(1);
}
if (process.env.RESET === "--reset") {
  await sql.unsafe(`drop database if exists "${name}" with (force)`);
  const redis = new Bun.RedisClient(process.env.REDIS_URL);
  let cursor = "0";
  let cleared = 0;
  do {
    const [next, keys] = await redis.send("SCAN", [cursor, "MATCH", `${process.env.REDIS_KEY_PREFIX}*`, "COUNT", "500"]);
    cursor = next;
    if (keys.length > 0) cleared += await redis.send("UNLINK", keys);
  } while (cursor !== "0");
  redis.close();
  console.log(`Dropped ${name} and ${cleared} Redis keys under ${process.env.REDIS_KEY_PREFIX}`);
}
if (!found || process.env.RESET === "--reset") await sql.unsafe(`create database "${name}"`);
await sql.unsafe(`comment on database "${name}" is '${comment.replaceAll("'", "''")}'`);
await sql.end();
EOF

cd "$ROOT"
bun install
bun run db:migrate
bun run db:seed
echo "Worktree ready: bun run dev serves the dashboard at http://localhost:$(env_value WEB_PORT "$ENV")," \
  "the api at http://localhost:$(env_value API_PORT "$ENV")."
