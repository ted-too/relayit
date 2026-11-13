# syntax=docker/dockerfile:1.4

FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS builder
# Installs skip dependencies' own install scripts, as CI's do, and the root `prepare`
# (it patches tsc and installs the git hook, neither of which a build uses).
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN cd apps/template-builder && NODE_ENV=production bun run build

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

# This install runs as root with XDG_CACHE_HOME set, so bun creates its cache
# under /home/relayit as root; chown it back or runtime installs fail (EACCES).
# Runtime extras not fully inlined by bun build (react-email isolate + workspace installs).
RUN echo '{"dependencies":{"react": "^19.0.0", "react-dom": "^19.0.0", "@react-email/components": "^0.5.3", "@react-email/render": "^1.4.0"}}' > package.json && \
    bun install --production && \
    chown -R relayit:relayit /app /home/relayit

COPY --from=builder --chown=relayit:relayit /app/apps/template-builder/build ./
COPY --from=builder --chown=relayit:relayit /app/packages/persistence/drizzle ./drizzle
COPY --from=builder --chown=relayit:relayit /app/packages/template-render/src/react-email/isolate-runner.ts ./isolate-runner.ts

# Internal Rpc. Railway sets PORT.
USER relayit
EXPOSE 8080

ENTRYPOINT ["bun", "run", "index.js"]
