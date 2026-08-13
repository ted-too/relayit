import { DB } from "@repo/persistence/db/effect";
import { organization } from "@repo/persistence/db/schema";
import { generateDbSlug } from "@repo/persistence/db/slug";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Effect } from "effect";
import { sessionMiddleware } from "@/lib/auth.functions";
import { auth } from "@/lib/auth.server";
import { runApp } from "@/lib/layers.server";
import { createProjectBodySchema } from "@/lib/projects/schemas";

/**
 * Create a Project (Better Auth organization) with a unique server-side slug.
 * `afterCreateOrganization` allocates sandbox when available.
 */
export const createProjectFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(createProjectBodySchema)
  .handler(async ({ data, context }) => {
    const headers = getRequestHeaders();
    const slug = await runApp(
      Effect.gen(function* () {
        const db = yield* DB;
        return yield* generateDbSlug(db, organization, data.name);
      })
    );

    const createdOrg = await auth.api.createOrganization({
      body: {
        keepCurrentActiveOrganization: false,
        name: data.name,
        slug,
        userId: context.session.user.id,
      },
      headers,
    });

    if (!createdOrg) {
      throw new Error("Failed to create Project");
    }

    const full = await auth.api.getFullOrganization({
      headers,
      query: { organizationId: createdOrg.id },
    });

    if (!full) {
      throw new Error("Failed to load Project after create");
    }

    return full;
  });
