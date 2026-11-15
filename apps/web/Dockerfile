# syntax=docker/dockerfile:1.4

FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS builder
# Installs skip dependencies' own install scripts, as CI's do, and the root `prepare`
# (it patches tsc and installs the git hook, neither of which a build uses).
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN cd apps/web && NODE_ENV=production bun run build

FROM base AS runner
WORKDIR /app

RUN groupadd --system --gid 953 relayit && \
    useradd --system --uid 953 --gid relayit --home-dir /home/relayit --create-home relayit

ENV HOME=/home/relayit \
    TMPDIR=/tmp \
    BUN_TMPDIR=/tmp

# The dashboard's static build and the small server that serves it. Nothing about a
# deployment is in the build: the server answers /config.js from API_URL as it starts.
COPY --from=builder --chown=relayit:relayit /app/apps/web/dist ./dist
COPY --from=builder --chown=relayit:relayit /app/apps/web/build/index.js ./server.js

# The dashboard: static files only. Railway sets PORT.
USER relayit
EXPOSE 3000

ENTRYPOINT ["bun", "run", "server.js"]
