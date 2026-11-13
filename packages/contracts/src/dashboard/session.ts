import { Context, Schema } from "effect";
import { HttpApiMiddleware } from "effect/http-api";

/** No signed-in session: the dashboard sends the person to sign in. */
export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
  "Unauthenticated",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/**
 * Not allowed: the Project doesn't exist, the user isn't one of its members, their role
 * lacks the permission, or the request came from another site. One answer for all of
 * them, so a Project's existence isn't revealed to a non-member.
 */
export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

/** The signed-in user. */
export class DashboardUser extends Context.Service<
  DashboardUser,
  { readonly email: string; readonly id: string }
>()("contracts/dashboard/DashboardUser") {}

/** The Project a request is for, and the signed-in user's membership of it. */
export class DashboardMember extends Context.Service<
  DashboardMember,
  {
    readonly organizationId: string;
    readonly organizationSlug: string;
    readonly role: string;
    readonly userId: string;
  }
>()("contracts/dashboard/DashboardMember") {}

type Action = "create" | "read" | "update" | "delete";

/**
 * The permissions an endpoint of a Project needs, by resource, as the organization roles
 * in `@repo/persistence/auth/permissions` grant them. `ProjectAccess` refuses a member
 * whose role lacks any of them, before the handler runs.
 */
export class RequiresPermission extends Context.Service<
  RequiresPermission,
  { readonly [Resource in "apiKey" | "domain" | "template"]?: ReadonlyArray<Action> }
>()("contracts/dashboard/RequiresPermission") {}

/** Resolves the session cookie to its user; 401 without one. */
export class DashboardSession extends HttpApiMiddleware.Service<
  DashboardSession,
  { provides: DashboardUser }
>()("contracts/dashboard/DashboardSession", { error: [Unauthenticated, Forbidden] }) {}

/**
 * Resolves the session cookie and the `:orgSlug` path param to the user's membership of
 * that Project, then checks the endpoint's `RequiresPermission`: 401 without a session,
 * 403 otherwise.
 */
export class ProjectAccess extends HttpApiMiddleware.Service<
  ProjectAccess,
  { provides: DashboardMember }
>()("contracts/dashboard/ProjectAccess", { error: [Unauthenticated, Forbidden] }) {}
