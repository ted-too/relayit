# Deploys

Relayit ships as four images on GitHub Container Registry, `ghcr.io/ted-too/relayit-{api,worker,web,template-builder}`, each built from `apps/<app>/Dockerfile` with the repository root as context. Self-hosters run them with the root `docker-compose.yaml` (the migrate step, api, worker, web, Postgres 18, Redis 7; the builder is not in it); their guide is the public [self-hosting page](../../apps/site/content/docs/self-hosting.md).

## Releases

- **A pull request into `main`** builds all four images and pushes them as `:pr-<number>` (`.github/workflows/build-images.yml`).
- **A push to `main`** runs semantic-release (`.github/workflows/semantic-release.yml`, `release.config.cjs`). `main` is a prerelease branch, so a release is the next `v1.0.0-alpha.N`: a GitHub Release and tag, no changelog commit. `feat`, `fix`, `perf`, `refactor` and `revert` commits release; `docs`, `chore`, `test`, `build`, `ci` and `style` don't. PRs are squash-merged, so the PR title is the commit it reads.
- **A release** builds the four images in the same workflow and pushes them as `:<version>` and `:alpha`. The `stable` branch exists only because semantic-release requires a non-prerelease branch; nothing is pushed to it, and the `:main` tag it would produce is unused.

## What lives where

- **The images** hold the bundled app, the migrations (`/app/drizzle`, found through `DRIZZLE_MIGRATIONS_FOLDER`; in the api's, the worker's and the builder's) and, for api, worker and builder, the React Email isolate runner and the few runtime packages the bundle doesn't inline. They run as an unprivileged user.
- **Migrations** are applied by one step per release, never by an app as it starts: see [Migrations](#migrations).
- **Two public hostnames**, one per service: the api's (`API_URL`, api.relayit.io) and the dashboard's (`APP_URL`, app.relayit.io). They must be one site, subdomains of one domain, or the session cookie isn't sent. The api reads both: `API_URL` is better-auth's base URL, so the GitHub OAuth callback is `API_URL/auth/callback/github` and Stripe's webhook `API_URL/auth/stripe/webhook`; `APP_URL` is the one origin it grants CORS and trusts for sign-in. The worker reads `API_URL` (SNS, unsubscribe links). The web image reads `API_URL` alone, the api's public URL that the browser calls.
- **The web image** is nginx and the dashboard's build, gzipped at image build: static files with a fallback to `index.html`, `assets/` cached for a year, everything else revalidated, and on all of it `X-Frame-Options: DENY`, `nosniff`, a referrer policy, HSTS (no `preload`; browsers ignore it over plain http) and a Content-Security-Policy: scripts and workers only from the image, no inline script, connections only to itself and the api's origin (from `API_URL`), images and fonts from any https origin, since avatars, Project logos and the template preview's email are other origins'. Its entrypoint writes `/config.js` from `API_URL` as it starts and refuses to start without one, so nothing about a deployment is in the image; changing the api's URL is a restart, not a rebuild. It has no database or secrets.
- **Variables** are each app's schema (`apps/*/src/env.ts`); the README's tables describe the required ones. `BETTER_AUTH_SECRETS` must match across apps and is rotated by prepending a new version (`2:new,1:old`).
- **The worker** is its own service and the only thing that runs jobs: without it the api still accepts sends, and they queue in Postgres and Redis until a worker runs. It serves no HTTP and exposes no port; it exits non-zero on a fatal failure, for the platform to restart it. Several replicas are safe. Its variables are `apps/worker/src/env.ts`: beyond the shared database, Redis, secrets and bucket, it needs the `SES_*` account, `API_URL` (where it points SES's notifications, and where unsubscribe links go) and, for a Sandbox Domain, `CF_*`. At startup it makes the SES configuration set and SNS subscription in each of `SES_REGIONS`, and the Sandbox Domain when `CF_*` is set.
- **The SES account** is environment, not data: `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` and `SES_REGIONS` (comma-separated) on the api (which registers Domains) and the worker. New Domains are registered in the first region, and Domains registered before regions were recorded are sent through it, so the first must stay the region those Domains are in. Both refuse to start with `EMAIL_BACKEND=ses` (the default for the images) and any of the three unset.
- **The api** is HTTP only, one process per replica; scale it with replicas.

## Migrations

A release's migrations are applied by one step, `bun run migrate.js`, which only the api image carries (`apps/api/src/migrate.ts`). It needs `DATABASE_URL` and nothing else, takes a Postgres advisory lock so two runs at once are safe, and exits 0 when the database has every migration the image carries, whether it applied them or found them applied. It exits non-zero when it could not migrate; a failed run rolls back whole, and running it again is safe.

No app migrates. The api, the worker and the builder each check, before they serve or take a job, that the database has every migration their own image carries. One that finds the database behind logs which migrations are missing, checks again every two seconds for five minutes, then exits non-zero. One that finds it ahead starts, because during any rollout the previous version runs against the schema the new release migrated. So every migration must leave the previous release working: add a column in one release and depend on it in the next, stop using one in one release and drop it in the next.

### Railway

The step is a pre-deploy command on the **api** service. Railway's documentation promises this much for one: it runs after the new image is ready and before the new deployment starts, in its own container from that image, on the private network with the service's variables (so `DATABASE_URL`), with no volumes; if it exits non-zero it is not retried and the deployment does not proceed; and it has no time limit unless Pre-deploy Timeout is set. Railway stops a previous deployment only once the new one is online, so when the step fails the previous api keeps serving.

Two things it does not promise:

- **How the command meets the image's entrypoint.** The documentation says a start command replaces an image's `ENTRYPOINT` and says nothing for a pre-deploy command. The api image therefore has a `CMD` and no `ENTRYPOINT` of its own, so the command runs whether Railway replaces the entrypoint or passes the command to it. The first deploy with the setting is the proof: the pre-deploy log ends with `Database migrations up to date`.
- **That other services wait.** Railway deploys each service by itself; nothing holds the worker or the builder back until the api's pre-deploy command has finished. The apps' own check covers that: a new worker or builder that starts first waits for the step.

#### The api's healthcheck comes first

The api service must have `/health` as its healthcheck path before any of this is relied on. Railway marks a deployment with no healthcheck active as soon as its container starts, and then stops the previous one. An api that finds the database behind does not listen while it waits, so without the healthcheck a release whose migration was not applied (the command missing, or failing on a deploy that went ahead some other way) takes the api down: the new one replaces the old, waits five minutes, exits and is restarted, and for that time sends are refused, the dashboard is down and unsubscribe links fail. With the healthcheck, the new api never answers, Railway fails the deployment when the healthcheck times out (300 seconds by default), and the previous api keeps serving. The builder serves `/health` too and should have the same setting. The worker serves no HTTP and can have none.

#### Setting it up

Do these in order.

1. On the api service, confirm Settings → Deploy → Healthcheck Path is `/health`, and set it if it is not. Do the same on the builder.
2. Confirm the production database has every migration on `main`. The first deploy of an image that checks finds anything missing and waits rather than starts. Compare the folder names in `packages/persistence/drizzle/` with:

   ```sql
   select name from drizzle.__drizzle_migrations order by name;
   ```

   Every folder must be in the result. Rows the folder does not have are fine.

3. Deploy the first release whose api image carries `migrate.js`, with no pre-deploy command yet. An image from before it has no `migrate.js`, so the command set early would fail and block the deploy.
4. On the api service, set Settings → Deploy → Pre-deploy Command to:

   ```
   bun run migrate.js
   ```

5. Set Pre-deploy Timeout to 600 seconds. Without one a step that hangs holds the deployment open for good, and a step can hang: it waits without limit for the advisory lock while another run, or a session that died holding it, has it. Ten minutes is far longer than a migration here takes; raise it for a release with a slow one.
6. Deploy the api and read the pre-deploy log. It ends with `Database migrations up to date`.

All of this must be done before the first release that carries a migration.

#### What a release does afterwards

When the step succeeds, there is no ordering to arrange by hand, which is weaker than before, when the worker had to be rolled out after the api or it ran against a schema it did not match. A new worker or builder that starts before the step has finished waits for it. While a new worker waits no jobs run, because Railway has stopped the previous one; accepted sends stay queued and go out when it gets going.

When the step fails, the api stays on the previous release. The release's worker and builder wait five minutes and exit non-zero. Railway's default restart policy is On Failure with at most ten restarts, so they are restarted and wait again, and once the restarts are used up they stay crashed. Nothing runs jobs meanwhile (#100). Fix the migration, redeploy the api so the step runs, then redeploy the worker and the builder if they have crashed.

#### Rolling back

With the command set, redeploying an api image from before the migrate step existed does not work: that image has no `migrate.js`, so the pre-deploy command fails, or runs until its timeout, and the deployment does not proceed. Clear the Pre-deploy Command first, roll back, and set it again when moving forward. Rolling back to any image that has the step needs nothing: the step finds the database ahead of it and exits 0, and the app starts.

### Docker Compose

`docker-compose.yaml` has a `migrate` service: the api image running `bun run migrate.js`, once Postgres is healthy. The api and the worker depend on it with `service_completed_successfully`, so `docker compose up` migrates and then starts them, and starts neither when it fails. It runs again on every `up` and changes nothing when the database is current.
