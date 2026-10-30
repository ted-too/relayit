# syntax=docker/dockerfile:1.4
# Marketing site, docs and legal pages (relayit.io).
# https://turborepo.dev/docs/guides/tools/docker

FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS prepare
RUN bun add -g turbo@2.10.6
COPY . .
RUN turbo prune @repo/site --docker

FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
# prune --docker omits the root tsconfig that apps/site extends.
COPY --from=prepare /app/tsconfig.json ./tsconfig.json
RUN NODE_ENV=production bun run turbo build --filter=@repo/site

FROM oven/bun:1 AS runner
WORKDIR /app
RUN groupadd --system --gid 953 vite && \
    useradd --system --uid 953 --gid vite --home-dir /home/vite --create-home vite
ENV HOME=/home/vite \
    NODE_ENV=production
COPY --from=builder --chown=vite:vite /app/apps/site/.output ./
USER vite
EXPOSE 3000
# APP_URL: dashboard origin, used for links and session lookups.
CMD ["bun", "run", "server/index.mjs"]
