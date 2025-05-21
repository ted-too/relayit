import { count, eq, and } from "drizzle-orm";
import slugify from "slugify";
import { db, schema } from "@repo/db";

/**
 * Generates a unique slug for a project within an organization.
 * If the initial slug derived from the name exists, it appends '-1', '-2', etc.
 */
export async function generateProjectSlug(
	name: string,
	organizationId: string,
): Promise<string> {
	const baseSlug = slugify(name, { lower: true, strict: true });
	let slug = baseSlug;
	let counter = 1;

	// Loop until a unique slug is found
	while (true) {
		const existing = await db
			.select({ count: count() })
			.from(schema.project)
			.where(
				and(
					eq(schema.project.organizationId, organizationId),
					eq(schema.project.slug, slug),
				),
			);

		if (existing[0].count === 0) {
			break; // Slug is unique
		}

		// If slug exists, append counter and try again
		slug = `${baseSlug}-${counter}`;
		counter++;
	}
	return slug;
}

/**
 * Generates a unique slug for a provider credential within an organization,
 * considering whether it's project-specific or organization-wide.
 */
export async function generateProviderSlug(
	name: string,
	organizationId: string,
): Promise<string> {
	const baseSlug = slugify(name, { lower: true, strict: true });
	let slug = baseSlug;
	let counter = 1;

	// Loop until a unique slug is found for the given scope (org or project)
	while (true) {
		const existing = await db
			.select({ count: count() })
			.from(schema.providerCredential)
			.where(
				and(
					eq(schema.providerCredential.organizationId, organizationId),
					eq(schema.providerCredential.slug, slug),
				),
			);

		if (existing[0].count === 0) {
			break; // Slug is unique
		}

		slug = `${baseSlug}-${counter}`;
		counter++;
	}
	return slug;
}

/**
 * Generates a unique slug for an organization based on a name.
 */
export async function generateOrganizationSlug(name: string): Promise<string> {
	const baseSlug = slugify(name, { lower: true, strict: true });
	let slug = baseSlug;
	let counter = 1;

	while (true) {
		const [existing] = await db
			.select({ count: count() })
			.from(schema.organization)
			.where(eq(schema.organization.slug, slug));

		if (existing.count === 0) {
			break; // Slug is unique
		}

		// If slug exists, append counter and try again
		slug = `${baseSlug}-${counter}`;
		counter++;
	}
	return slug;
}
