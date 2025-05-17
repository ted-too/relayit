import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "@repo/api";
import { createProjectSchema, updateProjectSchema } from "@repo/shared";
import { db, schema } from "@repo/db";
import { HTTPException } from "hono/http-exception";
import { generateProjectSlug } from "@repo/api/lib/slugs";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { verifyProject } from "@repo/api/lib/middleware";

export const projectRoutes = new Hono<Context>()
	.post(
		"/generate-slug",
		zValidator("json", z.object({ name: z.string() })),
		async (c) => {
			const validatedData = c.req.valid("json");
			const organization = c.get("organization");

			const slug = await generateProjectSlug(
				validatedData.name ?? "untitled",
				organization.id,
			);

			return c.json({ slug });
		},
	)
	// POST /projects - Create a new project
	.post("/", zValidator("json", createProjectSchema), async (c) => {
		const validatedData = c.req.valid("json");
		const organization = c.get("organization");

		const slug =
			validatedData.slug ??
			(await generateProjectSlug(
				validatedData.name ?? "untitled",
				organization.id,
			));

		const existingSlug = await db
			.select({ id: schema.project.id })
			.from(schema.project)
			.where(
				and(
					eq(schema.project.organizationId, organization.id),
					eq(schema.project.slug, slug),
				),
			)
			.limit(1);

		if (existingSlug.length > 0) {
			// This might happen in a race condition or if slug was provided
			throw new HTTPException(409, {
				message: "Project slug already exists in this organization",
			});
		}

		const [newProject] = await db
			.insert(schema.project)
			.values({
				organizationId: organization.id,
				name: validatedData.name ?? "Untitled Project",
				slug: slug,
				metadata: validatedData.metadata ?? null,
			})
			.returning();

		if (!newProject) {
			throw new HTTPException(500, { message: "Failed to create project" });
		}

		return c.json({ ...newProject }, 201);
	})

	// GET /projects - Get all projects in the organization
	.get("/", async (c) => {
		const organization = c.get("organization");

		const projects = await db.query.project.findMany({
			where: eq(schema.project.organizationId, organization.id),
			orderBy: desc(schema.project.createdAt),
		});

		return c.json(projects);
	})

	// GET /projects/byId/:projectId - Get a specific project by ID
	.get("/byId/:projectId", verifyProject, async (c) => {
		const projectId = c.req.param("projectId");
		const organization = c.get("organization");

		const project = await db.query.project.findFirst({
			where: and(
				eq(schema.project.id, projectId),
				eq(schema.project.organizationId, organization.id),
			),
		});

		if (!project) {
			throw new HTTPException(404, { message: "Project not found" });
		}

		return c.json(project);
	})

	// PATCH /projects/byId/:projectId - Update a project by ID
	.patch(
		"/byId/:projectId",
		verifyProject,
		zValidator("json", updateProjectSchema),
		async (c) => {
			const projectId = c.req.param("projectId");
			const validatedData = c.req.valid("json");
			const organization = c.get("organization");

			if (Object.keys(validatedData).length === 0) {
				throw new HTTPException(400, {
					message: "No fields provided for update",
				});
			}

			const existingProject = await db.query.project.findFirst({
				columns: { id: true, slug: true, organizationId: true },
				where: and(
					eq(schema.project.id, projectId),
					eq(schema.project.organizationId, organization.id),
				),
			});

			if (!existingProject) {
				throw new HTTPException(404, { message: "Project not found" });
			}

			// If slug is being updated, check for uniqueness within the organization
			if (validatedData.slug) {
				const existingSlug = await db
					.select({ id: schema.project.id })
					.from(schema.project)
					.where(
						and(
							eq(schema.project.organizationId, organization.id),
							eq(schema.project.slug, validatedData.slug),
						),
					)
					.limit(1);

				if (existingSlug.length > 0) {
					throw new HTTPException(409, {
						message: "Project slug already exists in this organization",
					});
				}
			}

			validatedData.metadata = validatedData.metadata ?? null;

			if (Object.keys(validatedData).length === 0) {
				return c.json(existingProject); // No actual changes, return existing data
			}

			const [updatedProject] = await db
				.update(schema.project)
				.set(validatedData)
				.where(eq(schema.project.id, projectId))
				.returning();

			if (!updatedProject) {
				throw new HTTPException(404, {
					message: "Project not found during update",
				});
			}

			return c.json(updatedProject);
		},
	);
