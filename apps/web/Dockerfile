FROM imbios/bun-node:1.2.4-20-alpine AS base
WORKDIR /usr/src/app

FROM base AS builder
RUN apk update
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN bun add turbo@^2.4.4 --global
COPY . .

RUN turbo prune @repo/web --docker

FROM base AS installer
RUN apk update
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY --from=builder /app/out/json .
RUN bun install --frozen-lockfile

ENV NODE_ENV=production

ARG API_URL
ARG WEB_URL
ARG DOCS_URL

ENV NEXT_PUBLIC_API_URL=$API_URL
ENV NEXT_PUBLIC_FRONTEND_URL=$WEB_URL
ENV NEXT_PUBLIC_DOCS_URL=$DOCS_URL

COPY --from=builder /app/out/full/ .
RUN bun run build

FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1003 nodejs
RUN adduser --system --uid 1003 nextjs
USER nextjs

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
 
CMD node apps/web/server.js