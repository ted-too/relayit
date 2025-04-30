import type { NullableContext } from "@repo/api";
import { errorResponse } from "@repo/api/lib/error-response";
import type { Context } from "hono";
import { createFactory } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import z from "zod";
import { auth } from "@repo/api/lib/auth";
import { db, schema } from "@repo/api/db";
import { eq } from "drizzle-orm";

const factory = createFactory<NullableContext>();

export const errorHandler = (err: Error | HTTPException, c: Context) => {
	if (err instanceof HTTPException) {
		return errorResponse(c, {
			status: err.status,
			message: err.message,
			details: Array.isArray(err.cause) ? err.cause : [],
		});
	}
	if (err instanceof z.ZodError) {
		return errorResponse(c, {
			status: 400,
			message: "Validation error",
			details: err.errors.map((err) => err.message),
		});
	}
	console.error(err);
	return errorResponse(c, {
		status: 500,
		message: "Something went wrong",
		details: [],
	});
};

export const authSessionMiddleware = factory.createMiddleware(
	async (c, next) => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });

		if (!session) {
			c.set("user", null);
			c.set("session", null);
			return next();
		}

		c.set("user", session.user);
		c.set("session", session.session);
		await next();
	},
);

export const protectedMiddleware = factory.createMiddleware(async (c, next) => {
	if (!c.get("user") || !c.get("session")) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	await next();
});

export const apiKeyMiddleware = factory.createMiddleware(async (c, next) => {
	const apiKey = c.req.header("X-API-Key");
	if (!apiKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { valid, error, key } = await auth.api.verifyApiKey({
		body: {
			key: apiKey,
		},
	});

	if (!valid || !key) {
		throw new HTTPException(401, { message: error?.message ?? "Unauthorized" });
	}

	c.set("apiKey", key);

	await next();
});

export const hasOrganizationSelected = factory.createMiddleware(
	async (c, next) => {
		const organizationId = c.get("session")?.activeOrganizationId;

		if (!organizationId) {
			throw new HTTPException(401, {
				message: "No active organization selected",
			});
		}

		const organization = await db.query.organization.findFirst({
			where: eq(schema.organization.id, organizationId),
		});

		if (!organization) {
			throw new HTTPException(404, { message: "Organization not found" });
		}

		c.set("organization", organization);

		await next();
	},
);

// export const hasChoresAdminAccess = factory.createMiddleware(
// 	async (c, next) => {
// 		const hasPermission = await auth.api.hasPermission({
// 			headers: c.req.raw.headers,
// 			body: {
// 				permission: {
// 					chore: ["create", "update", "delete"],
// 				},
// 			},
// 		});

// 		if (!hasPermission.success) {
// 			throw new HTTPException(401, {
// 				message: "You don't have permission to access this resource",
// 			});
// 		}

// 		await next();
// 	},
// );

// export const hasHouseholdAdminAccess = factory.createMiddleware(
// 	async (c, next) => {
// 		const hasPermission = await auth.api.hasPermission({
// 			headers: c.req.raw.headers,
// 			body: {
// 				permission: {
// 					organization: ["update"],
// 				},
// 			},
// 		});

// 		if (!hasPermission.success) {
// 			throw new HTTPException(401, {
// 				message: "You don't have permission to access this resource",
// 			});
// 		}

// 		await next();
// 	},
// );
