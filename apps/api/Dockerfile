# syntax=docker/dockerfile:1.4
# https://turborepo.dev/docs/guides/tools/docker

FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS prepare
RUN bun add -g turbo@2.10.6
COPY . .
RUN turbo prune @repo/api --docker

FROM base AS builder
# Install pruned deps first (changes less often than source).
COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
RUN --mount=type=secret,id=turbo_token \
    --mount=type=secret,id=turbo_team \
    TURBO_TOKEN=$(cat /run/secrets/turbo_token 2>/dev/null || echo "") \
    TURBO_TEAM=$(cat /run/secrets/turbo_team 2>/dev/null || echo "") \
    NODE_ENV=production bun run turbo build --filter=@repo/api

FROM base AS runner
WORKDIR /app

RUN groupadd --system --gid 953 relayit && \
    useradd --system --uid 953 --gid relayit --no-create-home relayit

# Runtime extras not fully inlined by bun build (pino transports / react-email).
RUN echo '{"dependencies":{"pino":"10.3.1", "react": "^19.0.0", "react-dom": "^19.0.0", "@react-email/components": "^0.5.3"}}' > package.json && \
    bun install --production

COPY --from=builder --chown=relayit:relayit /app/apps/api/build ./

# Deploy sets RUN_MODE (combined | api | worker | builder). Default: combined.
USER relayit
EXPOSE 3005

ENTRYPOINT ["bun", "run", "index.js"]
