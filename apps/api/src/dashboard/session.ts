import {
  DashboardMember,
  DashboardSession,
  DashboardUser,
  Forbidden,
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
 * The signed-in user behind a request's session cookie. A change (anything but GET or
 * HEAD) must come from the dashboard's own origin: the session cookie is `SameSite=Lax`,
 * so a browser leaves it off another site's POST anyway, and this refuses one that names
 * another origin even so. A request with no `Origin` is not from a browser page.
 */
const signedInUser = (auth: ApiAuth["Service"]["auth"], appOrigin: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const origin = request.headers.origin;
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      origin !== undefined &&
      origin !== appOrigin
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
