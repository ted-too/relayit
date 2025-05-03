import { z } from "zod";

// TODO: Implement this properly
export const projectProviderConfigSchema = z
	.record(z.string(), z.unknown())
	.optional();

export type ProjectProviderConfig = z.infer<typeof projectProviderConfigSchema>;

export const createProjectProviderAssociationSchema = z.object({
	providerCredentialId: z.string(),
	isActive: z.boolean().optional(),
	config: projectProviderConfigSchema,
});

export type CreateProjectProviderAssociationInput = z.infer<
	typeof createProjectProviderAssociationSchema
>;

export const updateProjectProviderAssociationSchema = z.object({
	isActive: z.boolean().optional(),
	config: projectProviderConfigSchema,
});

export type UpdateProjectProviderAssociationInput = z.infer<
	typeof updateProjectProviderAssociationSchema
>;

export const getProjectProviderAssociationsQuerySchema = z
	.object({
		isActive: z.boolean().optional(),
	})
	.partial();

export type GetProjectProviderAssociationsQueryInput = z.infer<
	typeof getProjectProviderAssociationsQuerySchema
>;
