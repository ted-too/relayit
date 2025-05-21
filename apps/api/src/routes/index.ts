import { router } from "@repo/api/trpc";
import { messagesRouter } from "@repo/api/routes/messages";
import { projectProviderAssociationRouter } from "@repo/api/routes/project-provider-associations";
import { projectRouter } from "@repo/api/routes/projects";
import { providerRouter } from "@repo/api/routes/providers";
import { webhookRouter } from "@repo/api/routes/webhooks";
import { miscRouter } from "@repo/api/routes/misc";

export const appRouter = router({
	messages: messagesRouter,
	projects: projectRouter,
	providers: providerRouter,
	projectProviderAssociations: projectProviderAssociationRouter,
	webhooks: webhookRouter,
	misc: miscRouter,
});

export type AppRouter = typeof appRouter;
