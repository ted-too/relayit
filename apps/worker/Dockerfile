# syntax=docker/dockerfile:1.4

# This is intentionally not using turbo prune - https://turborepo.com/docs/guides/tools/docker#the---docker-flag
# Because of this issue - https://github.com/vercel/turborepo/issues/10658
# TODO: Consider switching to it when this gets merged - https://github.com/vercel/turborepo/pull/10729

FROM oven/bun:1 AS base
WORKDIR /usr/src/app

FROM base AS deps
WORKDIR /app

COPY bun.lock* package.json turbo.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/*/package.json packages/

RUN bun install --frozen-lockfile

FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock* turbo.json ./
COPY apps/worker ./apps/worker/
COPY packages ./packages/
RUN --mount=type=secret,id=turbo_token \
    --mount=type=secret,id=turbo_team \
    TURBO_TOKEN=$(cat /run/secrets/turbo_token 2>/dev/null || echo "") \
    TURBO_TEAM=$(cat /run/secrets/turbo_team 2>/dev/null || echo "") \
    NODE_ENV=production bun run turbo build --filter=@repo/worker

FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1003 worker && \
    adduser --system --uid 1003 --ingroup worker worker

COPY --from=builder --chown=worker:worker /app/apps/worker/package.json ./package.json
COPY --from=builder --chown=worker:worker /app/node_modules ./node_modules
COPY --from=builder --chown=worker:worker /app/apps/worker/build ./

USER worker

ENTRYPOINT ["bun", "run", "index.js"]