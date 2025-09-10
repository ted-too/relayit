FROM oven/bun:1 AS base
WORKDIR /usr/src/app

FROM base AS builder
# RUN apk update
# RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN bun add turbo@^2.5.6 --global
COPY . .

RUN turbo prune @repo/api --docker

FROM base AS installer
# RUN apk update
# RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY --from=builder /app/out/json .
RUN bun install

ENV NODE_ENV=production
COPY --from=builder /app/out/full/ .
RUN bun run build

FROM base AS runner
WORKDIR /app

# Don't run production as root
RUN addgroup --system --gid 1003 bun
RUN adduser --system --uid 1003 honojs
USER honojs

COPY --from=installer --chown=honojs:bun /app/apps/api/build ./

EXPOSE 3005
ENTRYPOINT [ "bun", "run", "index.js" ]