# syntax=docker/dockerfile:1.4
# https://turborepo.dev/docs/guides/tools/docker

FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS prepare
RUN bun add -g turbo@2.10.6
COPY . .
RUN turbo prune @repo/template-builder --docker

FROM base AS builder
# Install pruned deps first (changes less often than source).
COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
RUN --mount=type=secret,id=turbo_token \
    --mount=type=secret,id=turbo_team \
    TURBO_TOKEN=$(cat /run/secrets/turbo_token 2>/dev/null || echo "") \
    TURBO_TEAM=$(cat /run/secrets/turbo_team 2>/dev/null || echo "") \
    NODE_ENV=production bun run turbo build --filter=@repo/template-builder

FROM base AS runner
WORKDIR /app

# Bun writes runtime cache under $HOME; without a home dir it resolves to "/"
# and can crash with "bun is unable to write files: AccessDenied".
RUN groupadd --system --gid 953 relayit && \
    useradd --system --uid 953 --gid relayit --home-dir /home/relayit --create-home relayit && \
    mkdir -p /home/relayit/.cache && \
    chown -R relayit:relayit /home/relayit

ENV HOME=/home/relayit \
    TMPDIR=/tmp \
    BUN_TMPDIR=/tmp \
    XDG_CACHE_HOME=/home/relayit/.cache \
    DRIZZLE_MIGRATIONS_FOLDER=/app/drizzle

# Runtime extras not fully inlined by bun build (react-email isolate + workspace installs).
RUN echo '{"dependencies":{"react": "^19.0.0", "react-dom": "^19.0.0", "@react-email/components": "^0.5.3", "@react-email/render": "^1.4.0"}}' > package.json && \
    bun install --production && \
    chown -R relayit:relayit /app

COPY --from=builder --chown=relayit:relayit /app/apps/template-builder/build ./
COPY --from=builder --chown=relayit:relayit /app/packages/persistence/drizzle ./drizzle
COPY --from=builder --chown=relayit:relayit /app/packages/template-render/src/react-email/isolate-runner.ts ./isolate-runner.ts

# Internal Rpc. Railway sets PORT.
USER relayit
EXPOSE 8080

ENTRYPOINT ["bun", "run", "index.js"]
