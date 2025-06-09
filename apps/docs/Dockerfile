FROM imbios/bun-node:1.2.12-20-alpine AS base
WORKDIR /usr/src/app

FROM base AS builder
RUN apk update
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN bun add turbo@^2.4.4 --global
COPY . .

RUN turbo prune @repo/docs --docker

FROM base AS installer
RUN apk update
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production

ARG API_URL
ARG WEB_URL
ARG DOCS_URL

ENV NEXT_PUBLIC_API_URL=$API_URL
ENV NEXT_PUBLIC_FRONTEND_URL=$WEB_URL
ENV NEXT_PUBLIC_WWW_URL=$DOCS_URL

COPY --from=builder /app/out/full/ .
# FIXME: There is currently a bug with turbo prune for bun where the lockfile is not updated.
# Will investigate this further.
RUN bun install --force
RUN bun run build

FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1003 nodejs
RUN adduser --system --uid 1003 nextjs
USER nextjs

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=installer --chown=nextjs:nodejs /app/apps/docs/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/docs/.next/static ./apps/docs/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/docs/public ./apps/docs/public
 
CMD PORT=3002 node apps/docs/server.js