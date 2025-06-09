import { db, schema } from "@repo/db";
import { betterAuth } from "better-auth";
import { emailHarmony } from "better-auth-harmony";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey, organization } from "better-auth/plugins";
import { passkey } from "better-auth/plugins/passkey";
import { redis } from "bun";
import { desc, eq } from "drizzle-orm";
import { generateOrganizationSlug } from "./slugs";

/**
 * Sets up initial organization, membership and project for a new user
 */
export async function initialUserSetup(userId: string) {
	const user = await db.query.user.findFirst({
		where: eq(schema.user.id, userId),
		columns: {
			name: true,
			email: true,
		},
	});

	if (!user) {
		throw new Error("User not found");
	}

	const name = `${user.name.split(" ")[0]}'s Organization`;
	const slug = await generateOrganizationSlug(name);

	return await db.transaction(async (tx) => {
		const [org] = await tx
			.insert(schema.organization)
			.values({
				name,
				slug,
			})
			.returning({
				id: schema.organization.id,
				slug: schema.organization.slug,
			});

		await tx.insert(schema.member).values({
			organizationId: org.id,
			userId,
			role: "owner",
		});

		await tx.insert(schema.project).values({
			name: "Default",
			slug: "default",
			organizationId: org.id,
		});

		return { id: org.id, slug: org.slug };
	});
}

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
	secondaryStorage: {
		get: async (key) => {
			const value = await redis.get(key);
			return value ? value : null;
		},
		set: async (key, value, ttl) => {
			if (ttl) {
				await redis.set(key, value);
				await redis.expire(key, ttl);
			} else await redis.set(key, value);
		},
		delete: async (key) => {
			await redis.del(key);
		},
	},
	emailAndPassword: {
		enabled: true,
	},
	plugins: [
		passkey(),
		apiKey({
			rateLimit: {
				enabled: true,
				// TODO: Investigate if we should use a different time window
				timeWindow: 1000 * 60 * 60, // 1 hour
				maxRequests: 100, // 100 requests per hour
			},
			enableMetadata: true,
			defaultPrefix: "rel_",
			disableSessionForAPIKeys: true,
		}),
		organization(),
		emailHarmony(),
		// captcha({
		//   provider: "cloudflare-turnstile", // or google-recaptcha, hcaptcha
		//   secretKey: process.env.TURNSTILE_SECRET_KEY!,
		// }),
	],
	databaseHooks: {
		session: {
			create: {
				before: async (session) => {
					let userOrg = (
						await db.query.member.findFirst({
							where: eq(schema.member.userId, session.userId),
							columns: {
								organizationId: true,
							},
							orderBy: desc(schema.member.createdAt),
						})
					)?.organizationId;

					if (!userOrg) {
						userOrg = (await initialUserSetup(session.userId)).id;
					}

					return {
						data: {
							...session,
							activeOrganizationId: userOrg,
						},
					};
				},
			},
		},
		user: {
			create: {
				after: async (user) => {
					await initialUserSetup(user.id);
				},
			},
		},
	},
	advanced: {
		cookiePrefix: "relayit",
		crossSubDomainCookies: {
			enabled: true,
			domain: `.${new URL(process.env.FRONTEND_URL!).hostname.split('.').slice(-2).join('.')}`,
		},
		generateId: false,
	},
	trustedOrigins: [process.env.FRONTEND_UR!, "https://dev.relayit.io"],
});
