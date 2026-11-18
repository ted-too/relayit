# syntax=docker/dockerfile:1.4

FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS builder
# Installs skip dependencies' own install scripts, as CI's do, and the root `prepare`
# (it patches tsc and installs the git hook, neither of which a build uses).
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN cd apps/web && NODE_ENV=production bun run build

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
    NODE_ENV=production

COPY scripts/entrypoint-vite.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY --from=builder --chown=vite:vite /app/apps/web/.output ./

USER vite
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh", "--target-dir", "/app"]
CMD ["bun", "run", "server/index.mjs"]
