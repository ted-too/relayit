import { Hono } from "hono";
import { logger } from "hono/logger";
import { auth, initialUserSetup } from "@repo/api/lib/auth";
import { cors } from "hono/cors";
import { sendRouter } from "@repo/api/routes/send";
import type { ParsedApiKey } from "@repo/api/db/schema/auth";
import { webhookRoutes } from "@repo/api/routes/webhooks";
import {
	authSessionMiddleware,
	hasOrganizationSelected,
	protectedMiddleware,
} from "@repo/api/lib/middleware";
import { db, schema } from "@repo/api/db";
import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { projectRoutes } from "@repo/api/routes/projects";
import type { InferSelectModel } from "drizzle-orm";
import { messagesRoutes } from "@repo/api/routes/messages";
import { providerRoutes } from "@repo/api/routes/providers";
import { projectProviderAssociationRoutes } from "@repo/api/routes/project-provider-associations";

type Session = typeof auth.$Infer.Session.session;

interface NullableVariables {
	user: typeof auth.$Infer.Session.user | null;
	session: Session | null;
	apiKey: Omit<ParsedApiKey, "key"> | null;
	organization: InferSelectModel<typeof schema.organization> | null;
}

type RawNonNullableVariables = {
	[K in keyof NullableVariables]: NonNullable<NullableVariables[K]>;
};

export interface NullableContext {
	Variables: NullableVariables;
}

interface SessionWithOrganization extends Session {
	activeOrganizationId: string;
}

interface NonNullableVariables extends RawNonNullableVariables {
	session: SessionWithOrganization;
}

export interface Context {
	Variables: NonNullableVariables;
}

export interface ApiKeyContext {
	Variables: Pick<NonNullableVariables, "apiKey">;
}

const app = new Hono<NullableContext>();

app.route("/send", sendRouter);

app.use(
	"*",
	cors({
		origin: [process.env.FRONTEND_URL],
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["POST", "PUT", "DELETE", "GET", "OPTIONS"],
		exposeHeaders: ["Content-Length"],
		maxAge: 600,
		credentials: true,
	}),
);

app.use("*", logger());

app.use("*", authSessionMiddleware);

app.on(["POST", "GET"], "/api/auth/*", (c) => {
	return auth.handler(c.req.raw);
});

const routes = app
	.use(protectedMiddleware)
	.post("/init-organization", async (c) => {
		const user = c.get("user");

		if (!user) {
			throw new HTTPException(401, {
				message: "Unauthorized",
			});
		}

		const existingUserOrg = await db.query.member.findFirst({
			where: eq(schema.member.userId, user.id),
			columns: {
				organizationId: true,
			},
			with: {
				organization: {
					columns: {
						slug: true,
					},
				},
			},
			orderBy: desc(schema.member.createdAt),
		});

		if (existingUserOrg) {
			return c.json({
				id: existingUserOrg.organizationId,
				slug: existingUserOrg.organization.slug,
			});
		}

		return c.json(await initialUserSetup(user.id));
	})
	.use(hasOrganizationSelected)
	.get("/invitations", async (c) => {
		const user = c.get("user");

		if (!user) {
			throw new HTTPException(401, {
				message: "Unauthorized",
			});
		}

		const invitations = await db.query.invitation.findMany({
			where: and(
				eq(schema.invitation.email, user.email),
				eq(schema.invitation.status, "pending"),
			),
			with: {
				organization: {
					columns: {
						name: true,
						logo: true,
					},
				},
			},
			columns: {
				id: true,
				expiresAt: true,
				role: true,
			},
		});

		return c.json(invitations);
	})
	.route("/projects", projectRoutes)
	.route("/projects/provider-associations", projectProviderAssociationRoutes)
	.route("/messages", messagesRoutes)
	.route("/providers", providerRoutes)
	.route("/webhooks", webhookRoutes);

export default {
	port: process.env.PORT || 3000,
	fetch: app.fetch,
};

export type AppType = typeof routes;
