import { trpcServer } from "@hono/trpc-server";
import { auth } from "@repo/api/lib/auth";
import { authSessionMiddleware } from "@repo/api/lib/middleware";
import { appRouter } from "@repo/api/routes";
import { sendRouter } from "@repo/api/routes/send";
import { createContext } from "@repo/api/trpc";
import type { ParsedApiKey, schema } from "@repo/db";
// @ts-expect-error - Scalar is not a module
import { Scalar } from "@scalar/hono-api-reference";
import type { InferSelectModel } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { openAPISpecs } from "hono-openapi";

type Session = typeof auth.$Infer.Session.session;

type NullableVariables = {
	user: typeof auth.$Infer.Session.user | null;
	session: Session | null;
	apiKey: Omit<ParsedApiKey, "key"> | null;
	organization: InferSelectModel<typeof schema.organization> | null;
};

type RawNonNullableVariables = {
	[K in keyof NullableVariables]: NonNullable<NullableVariables[K]>;
};

export type NullableContext = {
	Variables: NullableVariables;
};

interface SessionWithOrganization extends Session {
	activeOrganizationId: string;
}

interface NonNullableVariables extends RawNonNullableVariables {
	session: SessionWithOrganization;
}

export type Context = {
	Variables: NonNullableVariables;
};

export type ApiKeyContext = {
	Variables: Pick<NonNullableVariables, "apiKey">;
};

const app = new Hono<NullableContext>();

app.use("*", logger());

app.route("/send", sendRouter);

app.use(
	"*",
	cors({
		origin: [process.env.FRONTEND_URL, process.env.DOCS_URL],
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["POST", "PUT", "DELETE", "GET", "OPTIONS"],
		exposeHeaders: ["Content-Length"],
		maxAge: 600,
		credentials: true,
	})
);

app.get(
	"/openapi",
	openAPISpecs(app, {
		documentation: {
			info: {
				title: "RelayIt API",
				version: "1.0.0",
				description: "RelayIt API",
			},
			servers: [
				{ url: process.env.BETTER_AUTH_URL, description: "Local Server" },
			],
			components: {
				securitySchemes: {
					apiKey: {
						type: "apiKey",
						in: "header",
						name: "X-API-Key",
					},
				},
			},
			security: [
				{
					apiKey: [],
				},
			],
		},
	})
);

if (process.env.NODE_ENV === "development") {
	app.get("/reference", Scalar({ url: "/openapi" }));
}

app.on(["POST", "GET"], "/api/auth/*", authSessionMiddleware, (c) => {
	return auth.handler(c.req.raw);
});

app.use(
	"/trpc/*",
	trpcServer({
		router: appRouter,
		createContext,
	})
);

export default {
	port: process.env.PORT || 3000,
	fetch: app.fetch,
};
