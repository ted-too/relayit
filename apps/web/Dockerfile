FROM oven/bun:1 AS base
WORKDIR /usr/src/app

FROM base AS pruner
WORKDIR /app
RUN bun add turbo@^2.5.6 --global
COPY . .
RUN turbo prune @repo/web --docker

FROM base AS deps
WORKDIR /app
COPY --from=pruner /app/out/json .
# FIXME: There is currently a bug with turbo prune for bun where the lockfile is not updated.
# Will investigate this further. https://github.com/vercel/turborepo/discussions/7456
# RUN bun install --frozen-lockfile
RUN bun install

FROM base AS builder
ARG TURBO_TOKEN
ARG TURBO_TEAM
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=pruner /app/out/full .

RUN TURBO_TOKEN=$TURBO_TOKEN TURBO_TEAM=$TURBO_TEAM NODE_ENV=production bun run turbo build

FROM oven/bun:1 AS runner
WORKDIR /app

RUN addgroup --system --gid 1003 vite && \
    adduser --system --uid 1003 --ingroup vite vite

ENV VITE_API_URL=BAKED_VITE_API_URL \
    VITE_DOCS_URL=BAKED_VITE_DOCS_URL \
    VITE_BASE_URL=BAKED_VITE_BASE_URL

COPY scripts/entrypoint-vite.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY --from=builder --chown=vite:vite /app/apps/web/.output ./

USER vite
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh", "--target-dir", "/app"]
CMD ["bun", "run", "server/index.mjs"]
