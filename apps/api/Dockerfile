FROM imbios/bun-node:1.2.12-20-alpine AS base
WORKDIR /usr/src/app

FROM base AS builder
RUN apk update
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN bun add turbo@^2.4.4 --global
COPY . .

RUN turbo prune @repo/api --docker

FROM base AS installer
RUN apk update
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY --from=builder /app/out/json .
# FIXME: There is currently a bug with turbo prune for bun where the lockfile is not updated.
# Will investigate this further.
RUN bun install --force

ENV NODE_ENV=production
COPY --from=builder /app/out/full/ .
RUN bun run build

FROM base AS runner
WORKDIR /app

# Don't run production as root
RUN addgroup --system --gid 1003 nodejs
RUN adduser --system --uid 1003 honojs
USER honojs

COPY --from=installer --chown=honojs:nodejs /app/apps/api/build ./

COPY --from=installer /app/node_modules/sharp ./node_modules/sharp
COPY --from=installer /app/node_modules/semver ./node_modules/semver
COPY --from=installer /app/node_modules/color ./node_modules/color
COPY --from=installer /app/node_modules/detect-libc ./node_modules/detect-libc
COPY --from=installer /app/node_modules/@img ./node_modules/@img

# Run migration then start the app. Exit immediately if migration fails.
CMD ["/bin/sh", "-c", "set -e; bun run migrate.js; bun run index.js"]