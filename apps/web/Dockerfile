# syntax=docker/dockerfile:1.4
# https://turborepo.dev/docs/guides/tools/docker

FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS prepare
RUN bun add -g turbo@2.10.6
COPY . .
RUN turbo prune @repo/web --docker

FROM base AS builder
# Placeholders replaced at container start by scripts/entrypoint-vite.sh from
# VITE_API_URL / VITE_BASE_URL. Bake once; redeploy with different public URLs.
ENV VITE_API_URL=BAKED_VITE_API_URL \
    VITE_BASE_URL=BAKED_VITE_BASE_URL

# Install pruned deps first (changes less often than source).
COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
# prune --docker omits the root tsconfig that apps/web extends.
COPY --from=prepare /app/tsconfig.json ./tsconfig.json
RUN --mount=type=secret,id=turbo_token \
    --mount=type=secret,id=turbo_team \
    TURBO_TOKEN=$(cat /run/secrets/turbo_token 2>/dev/null || echo "") \
    TURBO_TEAM=$(cat /run/secrets/turbo_team 2>/dev/null || echo "") \
    NODE_ENV=production bun run turbo build --filter=@repo/web

FROM oven/bun:1 AS runner
WORKDIR /app

# Bun writes runtime cache under $HOME; without a home dir it resolves to "/"
# and crashes with "bun is unable to write files: AccessDenied".
RUN groupadd --system --gid 953 vite && \
    useradd --system --uid 953 --gid vite --home-dir /home/vite --create-home vite && \
    mkdir -p /home/vite/.cache && \
    chown -R vite:vite /home/vite

ENV HOME=/home/vite \
    TMPDIR=/tmp \
    BUN_TMPDIR=/tmp \
    XDG_CACHE_HOME=/home/vite/.cache \
    NODE_ENV=production \
    DRIZZLE_MIGRATIONS_FOLDER=/app/drizzle

COPY scripts/entrypoint-vite.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY --from=builder --chown=vite:vite /app/apps/web/.output ./
COPY --from=builder --chown=vite:vite /app/packages/persistence/drizzle ./drizzle

USER vite
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh", "--target-dir", "/app"]
CMD ["bun", "run", "server/index.mjs"]
