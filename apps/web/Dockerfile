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
ENV VITE_API_URL=BAKED_VITE_API_URL \
    VITE_DOCS_URL=BAKED_VITE_DOCS_URL \
    VITE_BASE_URL=BAKED_VITE_BASE_URL
WORKDIR /app

COPY --from=deps /app .

RUN TURBO_TOKEN=$TURBO_TOKEN TURBO_TEAM=$TURBO_TEAM NODE_ENV=production bun run turbo build --filter=@repo/web

FROM oven/bun:1 AS runner
WORKDIR /app

RUN addgroup --system --gid 1003 vite && \
    adduser --system --uid 1003 --ingroup vite vite

COPY scripts/entrypoint-vite.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY --from=builder --chown=vite:vite /app/apps/web/.output ./

USER vite
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh", "--target-dir", "/app"]
CMD ["bun", "run", "server/index.mjs"]
