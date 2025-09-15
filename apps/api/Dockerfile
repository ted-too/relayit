# This is intentionally not using turbo prune - https://turborepo.com/docs/guides/tools/docker#the---docker-flag
# Because of this issue - https://github.com/vercel/turborepo/issues/10658
# TODO: Consider switching to it when this gets merged - https://github.com/vercel/turborepo/pull/10729

FROM oven/bun:1 AS base
WORKDIR /usr/src/app

FROM base AS deps
WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile

FROM base AS builder
ARG TURBO_TOKEN
ARG TURBO_TEAM
WORKDIR /app

COPY --from=deps /app .

RUN TURBO_TOKEN=$TURBO_TOKEN TURBO_TEAM=$TURBO_TEAM NODE_ENV=production bun run turbo build --filter=@repo/api

FROM base AS runner
WORKDIR /app

# Required for pino logging
RUN echo '{"dependencies":{"pino":"^9.9.4","pino-pretty":"^13.1.1"}}' > package.json && \
    bun install --production

RUN addgroup --system --gid 1003 honojs && \
    adduser --system --uid 1003 --ingroup honojs honojs && \
    chown -R honojs:honojs /app && \
    chown -R honojs:honojs node_modules

COPY --from=builder --chown=honojs:honojs /app/apps/api/build ./

USER honojs
EXPOSE 3005

ENTRYPOINT ["bun", "run", "index.js"]