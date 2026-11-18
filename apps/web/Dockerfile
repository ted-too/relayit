# syntax=docker/dockerfile:1.29

FROM oven/bun:1.4.4 AS builder
WORKDIR /app
# Installs skip dependencies' own install scripts, as CI's do, and the root `prepare`
# (it patches tsc and installs the git hook, neither of which a build uses).
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN cd apps/web && NODE_ENV=production bun run build
# nginx serves these beside the originals (gzip_static) instead of compressing per request.
RUN find apps/web/dist -type f \
      \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.json' \
         -o -name '*.webmanifest' -o -name '*.ico' \) \
      -exec gzip -9 --keep {} +

# The dashboard is static files, so the image is nginx and the build: no JavaScript runtime.
# Nothing about a deployment is in the build; the entrypoint writes API_URL into /config.js
# as the container starts. Runs as nginx's unprivileged user.
FROM nginxinc/nginx-unprivileged:stable-alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 apps/web/nginx/10-api-origin.envsh /docker-entrypoint.d/10-api-origin.envsh

# Railway sets PORT.
ENV PORT=3000
EXPOSE 3000
