---
title: "Self-hosting"
description: "Run Relayit on your own infrastructure with Docker Compose: images, required environment variables, and what differs from Cloud."
---

## Overview

Relayit is source-available under the Business Source License 1.1. You can run it on your own servers for your own use. You may not offer it as a competing hosted notification service. See the [LICENSE](https://github.com/ted-too/relayit/blob/main/LICENSE) for the full terms.

A self-hosted install has three Relayit services, and optionally a fourth, plus Postgres, Redis, and S3-compatible storage:

| Service          | Image                                            | Role                                                                                                                                    |
| ---------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| migrate          | `ghcr.io/ted-too/relayit-api:<tag>`              | The api image running `bun run migrate.js`: applies the release's database migrations, then exits. The api and worker start after it.   |
| api              | `ghcr.io/ted-too/relayit-api:<tag>`              | Public API (`/health`, `POST /messages/email`, `/send/*`, SES notifications), sign-in, and everything the dashboard does.               |
| worker           | `ghcr.io/ted-too/relayit-worker:<tag>`           | Background jobs: sending, retries, Domain verification and outbound webhooks. No port. Without it, sends are accepted but never go out. |
| web              | `ghcr.io/ted-too/relayit-web:<tag>`              | The dashboard: static files that call the api from the browser.                                                                         |
| template-builder | `ghcr.io/ted-too/relayit-template-builder:<tag>` | Optional. Internal service for React Email workspace Git operations. Not in the default Compose file.                                   |
| postgres         | `postgres:18-alpine`                             | Database. Postgres 18 or later.                                                                                                         |
| redis            | `redis:7-alpine`                                 | Cache, sessions, and job queues. Redis 7 or later.                                                                                      |

You also need an S3-compatible bucket (for example Cloudflare R2, AWS S3, or a Bunny Storage zone) for attachments and template artifacts, and an Amazon SES account that all email goes through.

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
APP_URL=http://localhost:3000

POSTGRES_PASSWORD=your-secure-password
BETTER_AUTH_SECRETS=1:replace-with-output-of-openssl-rand-base64-32

S3_ENDPOINT=https://your-account.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=relayit
S3_ACCESS_KEY_ID=your-access-key-id
S3_SECRET_ACCESS_KEY=your-secret-access-key

SES_REGIONS=us-east-1
SES_ACCESS_KEY_ID=your-ses-access-key-id
SES_SECRET_ACCESS_KEY=your-ses-secret-access-key
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

`up` first runs the `migrate` service, which brings the database to the schema this release needs and exits; the api and the worker start only once it has succeeded. If they don't start, `docker compose logs migrate` says why. Every service but `migrate` restarts when it exits and, if Docker itself starts at boot, when the host reboots, until you `docker compose stop` or `down` it.

### A Postgres volume from an older Compose file

Postgres 18's image keeps its data one level deeper than earlier versions did, so the Compose file mounts the `relayit_postgres_data` volume at `/var/lib/postgresql` rather than at `/var/lib/postgresql/data`. A new install needs nothing. If your volume was written through the older mount, by Postgres 17 or earlier, the `postgres` service exits at start with "there appears to be PostgreSQL data in: /var/lib/postgresql" and nothing else starts. Your data is untouched, and has to be dumped by the version that wrote it and restored into 18:

```bash
docker compose down
docker volume ls --filter name=relayit_postgres_data   # the volume's full name
docker run --rm -v <volume>:/old alpine cat /old/PG_VERSION   # the version that wrote it

docker run -d --name relayit-postgres-old -v <volume>:/var/lib/postgresql/data postgres:<version>-alpine
until docker exec relayit-postgres-old pg_isready -h 127.0.0.1 -U postgres; do sleep 1; done
docker exec relayit-postgres-old pg_dump -U postgres -d relayit --no-owner > relayit.sql
docker rm -f relayit-postgres-old
```

Use your own `POSTGRES_USER` and `POSTGRES_DB` if you changed them. Check that `relayit.sql` holds your data and keep a copy, then remove the old volume and restore into a new one:

```bash
docker volume rm <volume>
docker compose up -d postgres
until docker compose exec -T postgres pg_isready -h 127.0.0.1 -U postgres; do sleep 1; done
docker compose exec -T postgres psql -U postgres -d relayit -v ON_ERROR_STOP=1 --single-transaction < relayit.sql
docker compose up -d
```

The wait matters: a new volume's Postgres first runs a short-lived setup server, and a restore sent to that one is cut off when it stops. If the restore reports an error, nothing was restored; fix the cause and run it again from `relayit.sql`.

Then open:

- Dashboard: http://localhost:3000
- API: http://localhost:3005

Sign up in the dashboard, create a Project, and follow the [Quickstart](/docs/quickstart) using your own API URL instead of `https://api.relayit.io`.

## Platform admins

A platform admin is a user who operates the deployment. Nobody is one until you say so, and signing up first does not make you one.

The role is full control over every account, so give it only to people you would trust with the database. A platform admin:

- sees the dashboard's Admin pages, which list every Project, and pauses and unpauses Domains;
- passes every admin endpoint of the sign-in service (better-auth's `/auth/admin/*`): listing, creating and removing users, setting any user's password, banning and unbanning, and changing any user's role, their own included. Impersonating a user is switched off: `/auth/admin/impersonate-user` and `/auth/admin/stop-impersonating` answer 404 for everyone.

Grant the role to a user who has signed up, and remove it, with the command in the api image:

```bash
docker compose exec api bun platform-admin.js grant you@your-domain.com
docker compose exec api bun platform-admin.js remove you@your-domain.com
```

`exec` needs the api container running. To run the command in a one-off container instead, replace the image's entrypoint, which otherwise starts a second api and never runs the command:

```bash
docker compose run --rm --entrypoint bun api platform-admin.js grant you@your-domain.com
docker run --rm --env-file api.env --entrypoint bun ghcr.io/ted-too/relayit-api:<tag> platform-admin.js grant you@your-domain.com
```

A one-off container needs the api's environment: all of it, `REDIS_KEY_PREFIX` included if you set one, since the command finds the user's sessions through it.

Both take effect at once:

- `grant` changes the role in the sessions the user already has open, so they don't sign in again.
- `remove` ends every session the user has open. They are signed out, and when they sign in again they are not an admin. It signs the named user out even if they were not an admin, so check the email.

The command prints how many open sessions it updated or ended; the last line it prints is the outcome. If it found none, it says so, names the Redis host and key prefix it searched, and does not claim the user was signed out: if that user is signed in, the command ran against a different Redis or `REDIS_KEY_PREFIX` than the api uses, and the change has not reached their sessions. It also warns when that Redis holds no session of any user, which on a deployment anyone is signed in to means the same thing.

It exits non-zero without claiming success if it could not confirm the sessions. Exit codes: `2` wrong arguments, `3` no user with that email, `4` the environment is incomplete, `5` the database could not be reached, `6` the sessions could not be confirmed (Redis unreachable, or a session read back unchanged), `7` the role was removed, or the user banned, but no session of theirs was found and the session store it searched (`REDIS_URL`, `REDIS_KEY_PREFIX`) holds no session of any user. On a deployment anyone is signed in to, that means it looked in the wrong place: fix the two variables and run it again. If nobody is signed in to the deployment, the change is complete and `7` can be ignored. The message says whether the change was made in the database before it stopped. If it was, run the command again: until it succeeds, a removed admin's open sessions may still have platform admin access, and a banned user's may still be signed in.

An existing admin can also grant the role through better-auth's own `/auth/admin/set-role`, which updates the user's open sessions too. Use the command to remove the role: `set-role` does not sign the user out, and a session left open can keep the old role.

Don't change the role by editing the `user` table. A signed-in user's sessions are kept in Redis, each with its own copy of the user and their role, and `/auth/admin/*` goes by that copy. A role removed in the database alone stays in those sessions until they end, and a session in use keeps renewing, so the user you demoted keeps those endpoints.

### Banning a user

The same command bans a user and lifts the ban, with the same ways to run it and the same exit codes. Its output is the same too, except that `unban` finding no open session is the expected case and says only that the user can sign in again:

```bash
docker compose exec api bun platform-admin.js ban someone@their-domain.com
docker compose exec api bun platform-admin.js unban someone@their-domain.com
```

- `ban` ends every session the user has open and refuses their sign-in, by password or GitHub, until the ban is lifted. It has no expiry. It bans whoever is named, a platform admin and yourself included, so check the email.
- `unban` lifts the ban. The user signs in again; nothing they owned was removed.

A ban is of the person, not of their Projects. A Project's API keys belong to the Project, so its sends are still accepted and delivered, and its other members still sign in. To stop a Project's mail as well, pause its Domains on the Admin pages.

A platform admin can also ban through better-auth's `/auth/admin/ban-user`, which takes an expiry and ends the user's sessions too, and lift a ban through `/auth/admin/unban-user`.

Don't ban by editing the `user` table, for the reason above: the user's open sessions stay open. A Project's dashboard operations and the Admin pages read the ban from the table and refuse them, but creating a Project and the sign-in service's own endpoints (`/auth/*`) go by the session and keep answering until it ends. Through those the user can still create an API key for a Project they belong to and send with it, change its members and invitations, and change their own account. If a ban was made that way, run `ban` for the user: it ends their sessions.

## Environment variables

`env.example` mirrors what the services validate at startup. Compose passes `API_URL` to the api, the worker and web, `APP_URL` to the api, and builds `DATABASE_URL` from the `POSTGRES_*` values.

`API_URL` and `APP_URL` mean the same thing everywhere: the public URL of the api, and of the dashboard. The dashboard calls the api from the browser with its session cookie, so the two must be the same site: two subdomains of one domain, such as `api.your-domain.com` and `app.your-domain.com`, or `localhost` on two ports. Hostnames on unrelated domains are not supported, and neither are two subdomains of a shared hosting suffix such as `*.up.railway.app`, which browsers treat as different sites; give both services subdomains of your own domain.

### api (required)

| Variable                                                                            | Description                                                                                                                      |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                      | Postgres connection string.                                                                                                      |
| `REDIS_URL`                                                                         | Redis connection string.                                                                                                         |
| `API_URL`                                                                           | Public URL of the api. Sign-in lives under it (`/auth/*`).                                                                       |
| `APP_URL`                                                                           | Public URL of the dashboard: the only origin allowed to call the api with the session cookie, and where sign-in returns to.      |
| `BETTER_AUTH_SECRETS`                                                               | Versioned secrets for auth and for sealing DKIM keys. Format `1:secret`, or `2:new,1:old` while rotating (the first is current). |
| `SES_REGIONS`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`                         | The same as the worker. The api registers new Domains with SES.                                                                  |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible object storage.                                                                                                    |

Optional: `LOG_LEVEL` (`All`, `Trace`, `Debug`, `Info`, `Warn`, `Error`, `Fatal` or `None`, in any case; `Info` if unset); `AUTH_COOKIE_DOMAIN`, a parent domain for the session cookie, only if another site of yours on that domain must see that a visitor is signed in; `CLIENT_IP_HEADER`, the header your reverse proxy puts the visitor's IP in (`X-Real-IP` from nginx or Railway, `CF-Connecting-IP` from Cloudflare), so sign-in is rate limited per visitor rather than for everyone at once. Name only a header your proxy overwrites, and keep the api reachable only through that proxy, or a visitor can send the header themselves. Stripe keys are optional and should be left unset for self-hosting. React Email workspace Git operations also need `TEMPLATING_BUILDER_URL` and `TEMPLATING_BUILDER_SECRET`, pointing at a running template-builder.

### worker (required)

| Variable                                     | Description                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `REDIS_URL`                  | The same as the api.                                                                                                                            |
| `API_URL`                                    | Public URL of the api. The worker points SES's notifications (through SNS) at it, and unsubscribe links go to it.                               |
| `BETTER_AUTH_SECRETS`                        | The same value as the api.                                                                                                                      |
| `S3_*`                                       | The same as the api.                                                                                                                            |
| `SES_REGIONS`                                | The SES regions to send through, comma-separated, for example `us-east-1` or `eu-central-1,us-east-1`. New Domains are registered in the first. |
| `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | IAM credentials for the SES account.                                                                                                            |

Optional: `LOG_LEVEL`, and `CF_API_TOKEN`, `CF_ROOT_DOMAIN`, `CF_ZONE_ID` for a Sandbox Domain on your Cloudflare zone. `CF_ROOT_DOMAIN` and every name under it are then reserved and can't be added as a Project's Domain, so give the Sandbox Domain a dedicated domain or subdomain rather than one your Projects send from, and don't point it at a name a Project already holds: if a Project holds `CF_ROOT_DOMAIN` or a name under it as a Domain, the worker logs an error as it starts and sets up no Sandbox Domain until that Domain is removed or the root is changed.

### web (required)

| Variable  | Description                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `API_URL` | Public URL of the api, which the dashboard calls from the browser. Read when the container starts, not built in. |

## Database migrations

No service migrates the database as it starts. Each release has one migrate step, in the api image:

```bash
bun run migrate.js
```

It needs only `DATABASE_URL`. It exits 0 when the database has every migration the release carries, whether it had to apply them or not, and non-zero when it could not migrate, leaving the database as it was. If it cannot connect to the database it tries again every two seconds for two minutes, logging why, before it gives up; a migration that fails is not tried again. Two runs at once are safe: the second waits for the first.

With Docker Compose this is the `migrate` service, and `docker compose pull && docker compose up -d` is the whole upgrade: it migrates, then replaces the api and the worker.

If you run the images another way, run the step to completion before you start or upgrade anything else, from the api image of the version you are moving to:

```bash
docker run --rm -e DATABASE_URL="postgres://user:pass@host:5432/relayit" \
  ghcr.io/ted-too/relayit-api:<tag> bun run migrate.js
```

Then start the api, the worker and, if you run it, the template-builder. One started too early does no harm: it logs which migrations the database lacks, waits up to five minutes for the step to finish, then exits with an error. It waits the same five minutes for a database it cannot reach, logging why every two seconds. The version already running keeps working while the step runs and until you replace it.

## Image tags

| Tag             | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `alpha`         | Always the newest alpha release. The Compose default.        |
| `1.0.0-alpha.N` | A specific alpha release. Pin this in production.            |
| `main`          | Latest stable release (not used while Relayit ships alphas). |

Release notes are on [GitHub Releases](https://github.com/ted-too/relayit/releases).

If your platform runs the old and new api side by side during an upgrade (Compose does not), then after upgrading past the release that flattened the send limits in `user_channel.limits`, run the `UPDATE` in its migration, [`20261118132136_flatten_user_channel_limits/migration.sql`](https://github.com/ted-too/relayit/blob/main/packages/persistence/drizzle/20261118132136_flatten_user_channel_limits/migration.sql), once more when the old api is gone (`psql` against the api's database, with that file). While both versions run, sends answer 500; and a sign-in the old api handled in the meantime stores that user's limits in the shape the new api refuses to send on, which the second run corrects.

After upgrading past the release that made Relayit delete only the SES identities it created, look in `job_dead_letter` for `email.delete-domain-identity` rows (`select payload, failed_at from job_dead_letter where job_name = 'email.delete-domain-identity'`). A delete queued by the old release and still waiting when the new worker started can't be read by it, so the identity of that removed Domain is still in SES, and adding the same domain again is refused until you delete the identity there by hand. If your platform runs the old and new releases side by side (Compose does not), stop the old worker before the new api takes traffic: the old worker deletes whatever identity a job names.

Before upgrading past the release that rewrote `docs/aws-ses-iam-policy.json` from the calls Relayit makes, apply the new file to your IAM user. The earlier file named a configuration set Relayit does not create (`relayit-default`; it is `relayit-delivery-events`), so a user holding exactly that file could not set up delivery notifications or send, and it lacked the tenant actions.

## Production notes

- Put the api and web behind a reverse proxy with TLS, for example `https://api.your-domain.com` and `https://app.your-domain.com`, and set `API_URL` and `APP_URL` to those URLs. Forward `X-Forwarded-For` to the api: sign-in is rate-limited per client address.
- The web image sends `Strict-Transport-Security` with a one-year lifetime. Browsers apply it only to a dashboard they reached over https, so a plain-http setup such as the local Compose one is unaffected. Once a browser has opened the dashboard's hostname over https, it refuses plain http there for a year, so don't move that hostname back to http.
- The api serves HTTP and the worker runs background jobs; scale each by running more replicas of it. Several workers share the queue safely.
- If sign-in fails from the dashboard, check that the api's `APP_URL` is the URL you open the dashboard at, that web's `API_URL` is the api's public URL, and that the two are subdomains of one domain.
- Check logs with `docker compose logs migrate`, `docker compose logs -f api`, `docker compose logs -f worker` and `docker compose logs -f web`. If sends stay queued, check that the worker is running.

## How self-hosted differs from Cloud

- **No Plans, unlimited entitlements.** Without Stripe keys, every user gets unlimited Projects, Domains, retention, and sends.
- **Email and password sign-in.** Social sign-in is not set up by default.
- **Your own SES account.** Email goes through the SES account in `SES_*`. Relayit creates an SES identity for each Domain and never takes over one it did not create: adding a Domain whose name is already an identity Relayit did not create, in that account and region, is refused, and the identity is left as it is. To move such a domain to Relayit, delete its identity in SES first, then add the Domain. When the worker starts it creates the SES configuration set and SNS topic each region needs and subscribes `API_URL` to it, so the IAM user needs SES, SNS and EventBridge permissions: [`docs/aws-ses-iam-policy.json`](https://github.com/ted-too/relayit/blob/main/docs/aws-ses-iam-policy.json) is the whole policy, every action Relayit calls and no other, with `ACCOUNT_ID` for you to replace. Apply it again when a release changes it, before you upgrade. Each Project sends through its own SES tenant, so that SES pauses one Project for its reputation and not your whole account (`ses:CreateTenant`, `ses:CreateTenantResourceAssociation`); without those the worker logs a warning on every send and all Projects share the account's reputation. It also sets the topic's retry policy (`sns:SetTopicAttributes`), so that SNS keeps retrying a notification the api is not ready for; without that permission the worker logs a warning and SNS retries for about a minute only. So that a Project SES pauses for its reputation has its Domains paused and unpaused as SES pauses and restores it, the worker also creates an EventBridge rule in each region for SES's tenant sending-status events, targets the topic with it, and adds a statement to the topic's policy that lets EventBridge publish there (`events:PutRule`, `events:PutTargets`, `sns:GetTopicAttributes`), and the api and the worker read the tenant's status (`ses:GetTenant`, `ses:GetReputationEntity`); The two sets fail differently. Without the three for the rule and the topic, the worker logs a warning and no event arrives: a paused Project's Domains are paused only when a send fails, and unpaused within five minutes of SES restoring it, when the worker checks again. Without the two `ses:` reads nothing is unpaused: the worker logs a warning naming them and checks again every hour, and the Domains stay paused until you grant them or an admin unpauses the Domains. Without `ses:GetTenant`, Relayit also cannot tell a pause of one Project from a pause of your whole account when SES refuses a send: the worker logs a warning naming the permission, no Domain is paused, and that Project's sends fail with "SES paused sending". Give the api the same `API_URL` and `SES_*` as the worker: it accepts SES's notifications only from the topics the worker made in that account, which it finds through STS (`GetCallerIdentity`, which needs no permission).
- **No Sandbox Domain by default.** It exists only if you give the worker a Cloudflare zone for it (`CF_*`).
- **Template workspace is optional.** Without a template-builder service, sending with existing Templates works, but editing the React Email workspace does not.

Everything else, including the API, Domains, Templates, and suppression, works the same as on Cloud.
