# Deploys

Relayit ships as four images on GitHub Container Registry, `ghcr.io/ted-too/relayit-{api,worker,web,template-builder}`, each built from `apps/<app>/Dockerfile` with the repository root as context. Self-hosters run them with the root `docker-compose.yaml` (api, worker, web, Postgres 18, Redis 7; the builder is not in it); their guide is the public [self-hosting page](../../apps/site/content/docs/self-hosting.md).

## Releases

- **A pull request into `main`** builds all four images and pushes them as `:pr-<number>` (`.github/workflows/build-images.yml`).
- **A push to `main`** runs semantic-release (`.github/workflows/semantic-release.yml`, `release.config.cjs`). `main` is a prerelease branch, so a release is the next `v1.0.0-alpha.N`: a GitHub Release and tag, no changelog commit. `feat`, `fix`, `perf`, `refactor` and `revert` commits release; `docs`, `chore`, `test`, `build`, `ci` and `style` don't. PRs are squash-merged, so the PR title is the commit it reads.
- **A release** builds the four images in the same workflow and pushes them as `:<version>` and `:alpha`. The `stable` branch exists only because semantic-release requires a non-prerelease branch; nothing is pushed to it, and the `:main` tag it would produce is unused.

## What lives where

- **The images** hold the bundled app, the migrations (`/app/drizzle`, found through `DRIZZLE_MIGRATIONS_FOLDER`; not in the worker's) and, for api, worker and builder, the React Email isolate runner and the few runtime packages the bundle doesn't inline. They run as an unprivileged user.
- **Migrations** apply when the api or builder starts, under an advisory lock, so a deploy migrates before the new version serves. A failed migration stops the app from starting. The worker never migrates and assumes a current schema: when a release adds a migration, roll out the api before the worker. A one-shot migration step at release time, run before any app, is the planned replacement (#31).
- **The web image** serves the dashboard and forwards `/api/*` and the unsubscribe POST to `API_URL`, the api's address as web reaches it; the api reads every other setting.
- **Variables** are each app's schema (`apps/*/src/env.ts`); the README's tables describe the required ones. `BETTER_AUTH_SECRETS` must match across apps and is rotated by prepending a new version (`2:new,1:old`).
- **The worker** is its own service and the only thing that runs jobs: without it the api still accepts sends, and they queue in Postgres and Redis until a worker runs. It serves no HTTP and exposes no port; it exits non-zero on a fatal failure, for the platform to restart it. Several replicas are safe. Its variables are `apps/worker/src/env.ts`: beyond the shared database, Redis, secrets and bucket, it needs the `SES_*` account, `API_URL` (where it points SES's notifications), `APP_URL` (unsubscribe links) and, for a Sandbox Domain, `CF_*`. At startup it makes the SES configuration set and SNS subscription in each of `SES_REGIONS`, and the Sandbox Domain when `CF_*` is set.
- **The SES account** is environment, not data: `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` and `SES_REGIONS` (comma-separated) on the api (which registers Domains) and the worker. New Domains are registered in the first region, and Domains registered before regions were recorded are sent through it, so the first must stay the region those Domains are in. Both refuse to start with `EMAIL_BACKEND=ses` (the default for the images) and any of the three unset.
- **The api** is HTTP only, one process per replica; scale it with replicas.
