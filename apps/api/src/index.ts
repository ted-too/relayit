import { Hono } from "hono";
import { logger } from "hono/logger";
import { auth, initialUserSetup } from "@repo/api/lib/auth";
import { cors } from "hono/cors";
import { sendRouter } from "@repo/api/routes/send";
import type { ParsedApiKey } from "@repo/api/db/schema/auth";
import { credentialRoutes, webhookRoutes } from "@repo/api/routes/core";
import {
	authSessionMiddleware,
	protectedMiddleware,
} from "@repo/api/lib/middleware";
import { db, schema } from "./db";
import { desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

type Session = typeof auth.$Infer.Session.session;

interface NullableVariables {
	user: typeof auth.$Infer.Session.user | null;
	session: Session | null;
	apiKey: Omit<ParsedApiKey, "key"> | null;
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
	.route("/teams/:teamId/credentials", credentialRoutes)
	.route("/teams/:teamId/webhooks", webhookRoutes);

export default {
	port: process.env.PORT || 3000,
	fetch: app.fetch,
};

export type AppType = typeof routes;
