FROM oven/bun:1 AS base
WORKDIR /usr/src/app

FROM base AS pruner
WORKDIR /app
RUN bun add turbo@^2.5.6 --global
COPY . .
RUN turbo prune @repo/worker --docker

FROM base AS deps
WORKDIR /app
COPY --from=pruner /app/out/json .
RUN bun install --frozen-lockfile

FROM base AS builder
ARG TURBO_TOKEN
ARG TURBO_TEAM
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=pruner /app/out/full .

RUN TURBO_TOKEN=$TURBO_TOKEN TURBO_TEAM=$TURBO_TEAM NODE_ENV=production bun run turbo build

FROM base AS runner
WORKDIR /app

# Required for pino logging
RUN echo '{"dependencies":{"pino":"^9.9.4","pino-pretty":"^13.1.1"}}' > package.json && \
    bun install --production

RUN addgroup --system --gid 1003 worker && \
    adduser --system --uid 1003 --ingroup worker worker && \
    chown -R worker:worker node_modules

COPY --from=builder --chown=worker:worker /app/apps/worker/build ./

USER worker

ENTRYPOINT ["bun", "run", "index.js"]