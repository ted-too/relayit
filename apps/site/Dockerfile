# Marketing site, docs and legal pages (relayit.io), as Railway builds it.
# Railway builds this from the repo root on every push to the branch the
# service follows; deploy settings (Dockerfile path, PORT, APP_URL) live on
# the service.
FROM oven/bun:1.3.5-alpine AS build
WORKDIR /app

# One layer: Railway builds on a fresh builder with no layer cache, so a
# separate install layer keyed on the lockfile would never hit.
# Nitro bundles the server with its dependencies, so the image ships no
# node_modules.
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts \
  && cd apps/site \
  && NODE_ENV=production bun run build

FROM oven/bun:1.3.5-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/site/.output .output
CMD ["bun", ".output/server/index.mjs"]
