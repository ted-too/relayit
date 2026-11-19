import {
  DashboardMember,
  DashboardSession,
  DashboardUser,
  Forbidden,
  PlatformAdmin,
  ProjectAccess,
  RequiresPermission,
  Unauthenticated,
} from "@repo/contracts/dashboard";
import { admin, member, owner } from "@repo/persistence/auth/permissions";
import { DB } from "@repo/persistence/db/effect";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { ApiAuth } from "../lib/auth";

const ROLES = { admin, member, owner };

const unauthenticated = new Unauthenticated({ message: "Sign in to continue." });
const forbidden = new Forbidden({
  message: "You do not have permission to do that in this Project.",
});

/**
 * Whether the user's row says they are banned now. Read from the row, not the session:
 * better-auth keeps a copy of the user beside the session in Redis for as long as the
 * session lives and answers `getSession` from it, so a ban set straight in the database
 * never reaches it. A ban with an expiry lapses at it, as better-auth treats one at sign-in.
 */
const isBanned = (row: { readonly banExpires: Date | null; readonly banned: boolean | null }) =>
  row.banned === true && (row.banExpires === null || row.banExpires.getTime() > Date.now());

/**
 * The signed-in user behind a request's session cookie, on the dashboard's routes, which
 * take that and nothing else:
 *
 * - An API key is refused (401) even beside a cookie: a server holding a key has the public
 *   API, and a key here would be a mistake worth saying so about rather than ignoring.
 * - A change (anything but GET or HEAD) must name the dashboard's origin in `Origin`, as
 *   better-auth requires of its own routes when a cookie is sent. Its check doesn't run
 *   here, since these handlers call `auth.api` directly, which skips it. The cookie is
 *   `SameSite=Lax`, so a browser leaves it off another site's POST anyway; this refuses one
 *   that names another origin, or none, even so.
 */
const signedInUser = (auth: ApiAuth["Service"]["auth"], appOrigin: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.headers["x-api-key"] !== undefined) {
      return yield* new Unauthenticated({
        message: "This endpoint takes a dashboard session, not an API key.",
      });
    }
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.headers.origin !== appOrigin
    ) {
      return yield* new Forbidden({ message: "Cross-site request refused." });
    }
    const session = yield* Effect.promise(() =>
      auth.api.getSession({ headers: new Headers(request.headers) }),
    );
    if (!session) {
      return yield* unauthenticated;
    }
    return session.user;
  });

export const DashboardSessionLive = (appOrigin: string) =>
  Layer.effect(
    DashboardSession,
    Effect.gen(function* () {
      const { auth } = yield* ApiAuth;
      return DashboardSession.of((httpEffect) =>
        Effect.gen(function* () {
          const user = yield* signedInUser(auth, appOrigin);
          return yield* Effect.provideService(httpEffect, DashboardUser, {
            email: user.email,
            id: user.id,
          }).pipe(Effect.annotateLogs({ userId: user.id }));
        }),
      );
    }),
  );

/**
 * Platform admins only, by better-auth's admin role on the user. The role and the ban are
 * read from the user's row on every request, not from the session's copy of the user (see
 * `isBanned`): going by the session would leave an admin demoted or banned straight in the
 * database with this until they signed out.
 */
export const PlatformAdminLive = (appOrigin: string) =>
  Layer.effect(
    PlatformAdmin,
    Effect.gen(function* () {
      const { auth } = yield* ApiAuth;
      const db = yield* DB;
      return PlatformAdmin.of((httpEffect) =>
        Effect.gen(function* () {
          const user = yield* signedInUser(auth, appOrigin);
          const row = yield* db.query.user
            .findFirst({
              columns: { banExpires: true, banned: true, role: true },
              where: { id: user.id },
            })
            .pipe(Effect.orDie);
          if (!row || isBanned(row) || !row.role?.split(",").includes("admin")) {
            return yield* new Forbidden({ message: "Only a platform admin can do that." });
          }
          return yield* Effect.provideService(httpEffect, DashboardUser, {
            email: user.email,
            id: user.id,
          }).pipe(Effect.annotateLogs({ userId: user.id }));
        }),
      );
    }),
  );

/**
 * Every operation on a Project's data goes through this: the session, then the Project
 * named by `:orgSlug`, then the user's membership of it, then the role's permission for
 * the endpoint. The handler sees only `DashboardMember`, so whatever it reads or changes
 * is scoped to that Project's id.
 *
 * A banned member is refused, by the ban on their row, which the membership query reads
 * with it. An operator's ban (`bun platform-admin.js ban`) ends the user's sessions, so
 * this is for the ban that did not: one written straight to the database.
 */
export const ProjectAccessLive = (appOrigin: string) =>
  Layer.effect(
    ProjectAccess,
    Effect.gen(function* () {
      const { auth } = yield* ApiAuth;
      const db = yield* DB;
      return ProjectAccess.of((httpEffect, { endpoint }) =>
        Effect.gen(function* () {
          const user = yield* signedInUser(auth, appOrigin);
          const { orgSlug } = yield* HttpRouter.params;
          if (orgSlug === undefined) {
            return yield* Effect.die("ProjectAccess on a route without :orgSlug");
          }
          const membership = yield* db.query.member
            .findFirst({
              columns: { organizationId: true, role: true },
              where: { organization: { slug: orgSlug }, userId: user.id },
              with: { user: { columns: { banExpires: true, banned: true } } },
            })
            .pipe(Effect.orDie);
          if (!membership) {
            return yield* forbidden;
          }
          // The foreign key gives every member a user; the relation's type does not say so.
          if (!membership.user) {
            return yield* forbidden;
          }
          if (isBanned(membership.user)) {
            return yield* new Forbidden({ message: "This account is banned." });
          }
          const required = Context.getOption(endpoint.annotations, RequiresPermission);
          if (
            required._tag === "Some" &&
            !membership.role
              .split(",")
              .some(
                (role) =>
                  ROLES[role as keyof typeof ROLES]?.authorize(required.value).success === true,
              )
          ) {
            return yield* forbidden;
          }
          return yield* Effect.provideService(httpEffect, DashboardMember, {
            organizationId: membership.organizationId,
            organizationSlug: orgSlug,
            role: membership.role,
            userId: user.id,
          }).pipe(
            Effect.annotateLogs({ organizationId: membership.organizationId, userId: user.id }),
          );
        }),
      );
    }),
  );
