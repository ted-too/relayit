---
title: "Self-hosting"
description: "Run Relayit on your own infrastructure with Docker Compose: images, required environment variables, and what differs from Cloud."
---

## Overview

Relayit is source-available under the Business Source License 1.1. You can run it on your own servers for your own use. You may not offer it as a competing hosted notification service. See the [LICENSE](https://github.com/ted-too/relayit/blob/main/LICENSE) for the full terms.

A self-hosted install has two Relayit services plus Postgres, Redis, and S3-compatible storage:

| Service | Image | Role |
| --- | --- | --- |
| api | `ghcr.io/ted-too/relayit-api:<tag>` | Public API (`/health`, `POST /messages/email`, `/send/*`, provider webhooks) and the background job worker, in one process. |
| web | `ghcr.io/ted-too/relayit-web:<tag>` | The dashboard and authentication. |
| template-builder | `ghcr.io/ted-too/relayit-template-builder:<tag>` | Optional. Internal service for React Email workspace Git operations. Not in the default Compose file. |
| postgres | `postgres:18-alpine` | Database. Postgres 18 or later. |
| redis | `redis:7-alpine` | Cache, sessions, and job queues. Redis 7 or later. |

You also need an S3-compatible bucket (for example Cloudflare R2, AWS S3, or a Bunny Storage zone) for attachments and template artifacts.

## Run with Docker Compose

Clone the repository and copy the example environment file:

```bash
git clone https://github.com/ted-too/relayit.git
cd relayit
cp env.example .env
```

Fill in `.env`. At minimum:

```bash
IMAGE_TAG=alpha

API_URL=http://localhost:3005
WEB_URL=http://localhost:3000

POSTGRES_PASSWORD=your-secure-password
BETTER_AUTH_SECRETS=1:replace-with-output-of-openssl-rand-base64-32

S3_ENDPOINT=https://your-account.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=relayit
S3_ACCESS_KEY_ID=your-access-key-id
S3_SECRET_ACCESS_KEY=your-secret-access-key
```

Generate the auth secret with:

```bash
openssl rand -base64 32
```

Start everything:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Then open:

- Dashboard: http://localhost:3000
- API: http://localhost:3005

Sign up in the dashboard, create a Project, and follow the [Quickstart](/docs/quickstart) using your own API URL instead of `https://api.relayit.io`.

## Environment variables

`env.example` mirrors what the services validate at startup. Compose maps `WEB_URL` to the api's `APP_URL` and the web's `VITE_BASE_URL`, and builds `DATABASE_URL` from the `POSTGRES_*` values.

### api (required)

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `REDIS_URL` | Redis connection string. |
| `API_URL` | Public URL of the API. |
| `APP_URL` | Public URL of the dashboard. Used for trusted origins and cookies. |
| `BETTER_AUTH_SECRETS` | Versioned secrets for auth and for sealing provider credentials and DKIM keys. Format `1:secret`, or `2:new,1:old` while rotating (the first is current). |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible object storage. |

Optional: `LOG_LEVEL`, and `WEB_CONCURRENCY` (on Linux, the number of HTTP child processes; the job worker stays on the primary process).

### web (required)

| Variable | Description |
| --- | --- |
| `VITE_BASE_URL` | Public URL of the dashboard. Can be changed at deploy time without a rebuild. |
| `DATABASE_URL` | Postgres connection string. |
| `REDIS_URL` | Redis connection string. |
| `BETTER_AUTH_SECRETS` | The same value as the api. |
| `API_URL` | Public URL of the API. Used to set up Provider delivery webhooks. |

Optional: `VITE_DEBUG`. Stripe keys are optional and should be left unset for self-hosting. React Email workspace Git operations also need `TEMPLATING_BUILDER_URL` and `TEMPLATING_BUILDER_SECRET`, pointing at a running template-builder.

## Image tags

| Tag | Description |
| --- | --- |
| `alpha` | Always the newest alpha release. The Compose default. |
| `1.0.0-alpha.N` | A specific alpha release. Pin this in production. |
| `main` | Latest stable release (not used while Relayit ships alphas). |

Release notes are on [GitHub Releases](https://github.com/ted-too/relayit/releases).

## Production notes

- Put the api and web behind a reverse proxy with TLS, for example `https://api.your-domain.com` and `https://app.your-domain.com`, and set `API_URL` and `WEB_URL` to those URLs.
- The api process serves HTTP and runs the job worker. Scale by running more api replicas.
- If the dashboard points at the wrong origin, restart web with the corrected `VITE_BASE_URL` and `API_URL`. No rebuild is needed.
- Check logs with `docker compose logs -f api` and `docker compose logs -f web`.

## How self-hosted differs from Cloud

- **No Plans, unlimited entitlements.** Without Stripe keys, every user gets unlimited Projects, Domains, retention, and sends. BYO Providers are always allowed.
- **Email and password sign-in.** Social sign-in is not set up by default.
- **No managed Provider or Sandbox Domain by default.** On Cloud, Relayit provides these. On your own install, an administrator adds email Providers in the dashboard's admin area, and the Sandbox Domain only exists if you configure Cloudflare for it. Until a Provider exists you cannot add a Domain.
- **Template workspace is optional.** Without a template-builder service, sending with existing Templates works, but editing the React Email workspace does not.

Everything else, including the API, Domains, Templates, and suppression, works the same as on Cloud.
