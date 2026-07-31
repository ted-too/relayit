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
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
CREDENTIAL_ENCRYPTION_KEY_V1=$(openssl rand -hex 32)

S3_ENDPOINT=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Self-hosted usage is unlimited (no send metering / Stripe). Sign-in is email/password only.

### 2. Deploy with Docker Compose

Compose runs **api** (`RUN_MODE=combined`) + **web** + Postgres 18 + Redis.

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

- `ghcr.io/ted-too/relayit-api:<tag>`
- `ghcr.io/ted-too/relayit-web:<tag>`

There is no separate worker image. The api image runs HTTP, workers, or both based on `RUN_MODE`. Prefer an env file (same keys as [env.example](env.example)):

```bash
docker run -d \
  --name relayit-api \
  -p 3005:3005 \
  --env-file .env \
  -e RUN_MODE=combined \
  -e DATABASE_URL="postgres://user:pass@host:5432/relayit" \
  -e REDIS_URL="redis://redis:6379" \
  -e APP_URL="http://localhost:3000" \
  ghcr.io/ted-too/relayit-api:alpha
```

### Dedicated worker (same image)

```bash
docker run -d \
  --name relayit-worker \
  --env-file .env \
  -e RUN_MODE=worker \
  -e DATABASE_URL="postgres://user:pass@host:5432/relayit" \
  -e REDIS_URL="redis://redis:6379" \
  ghcr.io/ted-too/relayit-api:alpha
```

Pair with `RUN_MODE=api` on the HTTP container when you split roles.

### Web dashboard

Build once; change public URLs at deploy time via `VITE_API_URL` and `VITE_BASE_URL`.

```bash
docker run -d \
  --name relayit-web \
  -p 3000:3000 \
  -e VITE_API_URL="http://localhost:3005" \
  -e VITE_BASE_URL="http://localhost:3000" \
  ghcr.io/ted-too/relayit-web:alpha
```

## Configuration

### Required environment (api)

Validated at process start (`apps/api` shared + server schemas). Compose maps `WEB_URL` → `APP_URL`.

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `API_URL` | Public API URL |
| `APP_URL` | Public web URL (trusted origin / cookies) |
| `BETTER_AUTH_SECRET` | Auth secret |
| `CREDENTIAL_ENCRYPTION_KEY_V1` | 64-char hex key (`ENCRYPTION_KEY_VERSION=v1`) |
| `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Object storage (`S3_BUCKET`, `S3_REGION` optional) |

Optional: `LOG_LEVEL`. Compose pins `RUN_MODE=combined` (builder in-process).

### Required environment (web)

| Variable | Description |
| --- | --- |
| `VITE_API_URL` | Public API URL (compose: from `API_URL`) |
| `VITE_BASE_URL` | Public web URL (compose: from `WEB_URL`) |

`VITE_DEBUG` is optional. Product edition defaults to `oss` (server-only `EDITION`).

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

BETTER_AUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY_VERSION=v1
CREDENTIAL_ENCRYPTION_KEY_V1=$(openssl rand -hex 32)
```

Plus S3 (and other required) values from [env.example](env.example). Compose always uses `RUN_MODE=combined`.

### Scaling workers

```bash
docker run -d --name relayit-worker-2 \
  --env-file .env \
  -e RUN_MODE=worker \
  -e DATABASE_URL="..." \
  -e REDIS_URL="..." \
  ghcr.io/ted-too/relayit-api:alpha
```

Use `RUN_MODE=api` on the HTTP tier when splitting roles.

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

**Web pointing at the wrong API** — restart web with updated `VITE_API_URL` / `VITE_BASE_URL` (no rebuild).

## Contributing

- Open a PR against `main`. PR CI builds `relayit-api` and `relayit-web`.
- After merge, semantic-release cuts the next `v1.0.0-alpha.N` and publishes GHCR images (including `:alpha`).
- Use [Conventional Commits](https://conventionalcommits.org/) (`feat:`, `fix:`, etc.).

## License

RelayIt is licensed under the [Business Source License 1.1](LICENSE).

You may self-host and use RelayIt in production for your own purposes. You may **not** offer RelayIt (or a substantially similar derivative) as a competing commercial hosted/managed notification service. On **2030-07-31**, this version converts to GPL-3.0-or-later.
