# RelayIt - Self-Hosted Notification Service

RelayIt is a self-hosted notification delivery service that abstracts the complexities of integrating with multiple communication APIs. Send messages across Email, SMS, WhatsApp, and Discord through a single, reliable endpoint.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- PostgreSQL 18+ (included in compose)
- Redis 7+ (included in compose)

### 1. Environment Setup

```bash
cp env.example .env
```

Fill every required value in `.env` (see [env.example](env.example) — it mirrors the api/web schemas). Minimum shape:

```bash
IMAGE_TAG=alpha

API_URL=http://localhost:3005
WEB_URL=http://localhost:3000

POSTGRES_PASSWORD=your-secure-password
BETTER_AUTH_SECRETS=1:$(openssl rand -base64 32)

S3_ENDPOINT=...
S3_REGION=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Self-hosted usage is unlimited (no send metering / Stripe). Sign-in is email/password only.

### 2. Deploy with Docker Compose

Compose runs **api** (HTTP + job worker in one process) + **web** + Postgres 18 + Redis.

```bash
docker compose pull
docker compose up -d

docker compose ps
docker compose logs -f
```

### 3. Access Your Instance

- **Web dashboard**: http://localhost:3000
- **API**: http://localhost:3005

## Individual Container Deployment

Images from [ted-too/relayit](https://github.com/ted-too/relayit):

- `ghcr.io/ted-too/relayit-api:<tag>` — public ingress (`/health`, `POST /messages/email`, `/send/*`, provider webhooks) and the job worker
- `ghcr.io/ted-too/relayit-web:<tag>` — dashboard and Better Auth
- `ghcr.io/ted-too/relayit-template-builder:<tag>` — internal template Rpc (workspace Git ops only; not in default compose)

Prefer an env file (same keys as [env.example](env.example)):

```bash
docker run -d \
  --name relayit-api \
  -p 3005:3005 \
  --env-file .env \
  -e DATABASE_URL="postgres://user:pass@host:5432/relayit" \
  -e REDIS_URL="redis://redis:6379" \
  -e APP_URL="http://localhost:3000" \
  ghcr.io/ted-too/relayit-api:alpha
```

### Web dashboard

Auth and session-authenticated ops run in this process. Change the public web URL at deploy time via `VITE_BASE_URL` (no rebuild).

```bash
docker run -d \
  --name relayit-web \
  -p 3000:3000 \
  --env-file .env \
  -e VITE_BASE_URL="http://localhost:3000" \
  -e API_URL="http://localhost:3005" \
  -e DATABASE_URL="postgres://user:pass@host:5432/relayit" \
  -e REDIS_URL="redis://redis:6379" \
  ghcr.io/ted-too/relayit-web:alpha
```

## Configuration

### Required environment (api)

Validated at process start (`apps/api` env packs). Compose maps `WEB_URL` → `APP_URL`.

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `API_URL` | Public API URL |
| `APP_URL` | Public web URL (trusted origin / cookies) |
| `BETTER_AUTH_SECRETS` | Versioned auth + sealing secrets (`1:…` or `2:new,1:old`) |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3-compatible object storage; Bunny Storage S3-compatible zones are supported |

Optional: `LOG_LEVEL`, `WEB_CONCURRENCY` (Linux production: HTTP child processes; the job worker stays on the primary).

### Required environment (web)

| Variable | Description |
| --- | --- |
| `VITE_BASE_URL` | Public web URL (compose: from `WEB_URL`) |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `BETTER_AUTH_SECRETS` | Same versioned secrets as api |
| `API_URL` | Public API URL; used to scaffold Provider delivery webhooks |

`VITE_DEBUG` is optional. Stripe keys are optional; when they are absent, entitlements are unlimited (self-hosted). Template workspace Git ops also need `TEMPLATING_BUILDER_URL` and `TEMPLATING_BUILDER_SECRET`.

### Image tags

| Tag | Description |
| --- | --- |
| `alpha` | Floating — always the newest alpha (default for compose) |
| `1.0.0-alpha.N` | Pin a specific alpha release |
| `pr-<n>` | PR preview build (CI only) |
| `main` | Latest **stable** release (not used while shipping alphas) |

Release notes: [GitHub Releases](https://github.com/ted-too/relayit/releases). Merge to `main` → next `v1.0.0-alpha.N` + GHCR `:alpha` after PR image CI is green.

## Production Deployment

### Reverse proxy

```nginx
# /etc/nginx/sites-available/relayit
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /api/ {
        proxy_pass http://localhost:3005;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Production env

```bash
API_URL=https://api.your-domain.com
WEB_URL=https://app.your-domain.com
IMAGE_TAG=alpha
# Or pin: IMAGE_TAG=1.0.0-alpha.3

BETTER_AUTH_SECRETS=1:$(openssl rand -base64 32)
```

Plus S3 (and other required) values from [env.example](env.example).

### Scaling

The api process serves HTTP and runs the job worker together. Scale by running more api replicas; HTTP and worker capacity move as one.

## Monitoring & Logs

```bash
docker compose logs api
docker compose logs web
docker compose logs -f --tail=100
```

## Troubleshooting

```bash
docker compose ps postgres
docker compose exec redis redis-cli ping

echo $GITHUB_TOKEN | docker login ghcr.io -u ted-too --password-stdin
docker pull ghcr.io/ted-too/relayit-api:alpha
```

**Web pointing at the wrong origin** — restart web with updated `VITE_BASE_URL` / `API_URL` (no rebuild).

## Contributing

- Open a PR against `main`. PR CI builds `relayit-api`, `relayit-web`, and `relayit-template-builder`.
- After merge, semantic-release cuts the next `v1.0.0-alpha.N` and publishes GHCR images (including `:alpha`).
- Use [Conventional Commits](https://conventionalcommits.org/) (`feat:`, `fix:`, etc.).

## License

RelayIt is licensed under the [Business Source License 1.1](LICENSE).

You may self-host and use RelayIt in production for your own purposes. You may **not** offer RelayIt (or a substantially similar derivative) as a competing commercial hosted/managed notification service. On **2030-07-31**, this version converts to GPL-3.0-or-later.
