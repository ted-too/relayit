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
import { APIError, BANNED_USER } from "@repo/persistence/auth/server";
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
 * - A session opened by impersonating is refused. Impersonation is switched off
 *   (`disabledPaths` in `createAuth`), so only a session from before that can be one, and
 *   it renews like any other, so it would not end by itself.
 * - A banned user is refused (403). `createAuth`'s hook reads the ban from the user's row
 *   whenever better-auth resolves a session, so `getSession` throws for one.
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
      auth.api.getSession({ headers: new Headers(request.headers) }).catch((cause: unknown) => {
        if (cause instanceof APIError && cause.body?.code === BANNED_USER) {
          return "banned" as const;
        }
        throw cause;
      }),
    );
    if (session === "banned") {
      return yield* new Forbidden({ message: "This account is banned." });
    }
    if (!session || session.session.impersonatedBy) {
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
 * Platform admins only, by better-auth's admin role on the user. The role is read from the
 * user's row on every request, not from the session's copy of the user: going by the
 * session would leave an admin demoted straight in the database with this until they
 * signed out.
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
              columns: { role: true },
              where: { id: user.id },
            })
            .pipe(Effect.orDie);
          if (!row?.role?.split(",").includes("admin")) {
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
            })
            .pipe(Effect.orDie);
          if (!membership) {
            return yield* forbidden;
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
