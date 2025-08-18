import type {
	NotificationProvider,
	ProjectDetails,
	ProjectProviderAssociation,
} from "@repo/db";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/shadcn/card";
import { ProjectNotificationProviderCard } from "@/components/notification-providers/card";
import type { ConfiguredIndicatorType } from "@/components/notification-providers/providers/configured-indicator";
import { DiscordProvider } from "@/components/notification-providers/providers/discord";
import { EmailProvider } from "@/components/notification-providers/providers/email";
import { SmsProvider } from "@/components/notification-providers/providers/sms";
import { WhatsappProvider } from "@/components/notification-providers/providers/whatsapp";

export async function ChannelsTab({
	project,
	allProviders,
}: {
	project: ProjectDetails;
	allProviders: NotificationProvider[];
}) {
	const configurationMap: Record<
		NotificationProvider["channelType"],
		ConfiguredIndicatorType
	> = {
		email: "not-configured",
		sms: "not-configured",
		whatsapp: "not-configured",
		discord: "not-configured",
	};

	for (const projectProvider of project.providerAssociations) {
		configurationMap[projectProvider.providerCredential.channelType] =
			"project-specific";
	}

	for (const provider of allProviders) {
		if (configurationMap[provider.channelType] !== "not-configured") {
			continue;
		}
		configurationMap[provider.channelType] = "default";
	}

	const projectConfiguredProviders: {
		provider: NotificationProvider;
		config: ProjectProviderAssociation;
	}[] = [];

	const restProviders: NotificationProvider[] = [];

	for (const provider of allProviders) {
		const config = project.providerAssociations.find(
			(pa) => pa.providerCredentialId === provider.id
		);
		if (config) {
			projectConfiguredProviders.push({ provider, config });
		} else {
			restProviders.push(provider);
		}
	}

	return (
		<div className="flex w-full flex-col gap-4">
			<Card className="max-w-none">
				<CardHeader className="flex flex-row items-center justify-between">
					<div className="flex flex-col">
						<CardTitle className="font-semibold text-xl tracking-tight">
							Channels
						</CardTitle>
						<CardDescription>
							This is what you can use to send messages to your recipients.
						</CardDescription>
					</div>
					<div className="flex items-center gap-4">
						<EmailProvider
							configured={{ configured: configurationMap.email }}
						/>
						<SmsProvider configured={{ configured: configurationMap.sms }} />
						<WhatsappProvider
							configured={{ configured: configurationMap.whatsapp }}
						/>
						<DiscordProvider
							configured={{ configured: configurationMap.discord }}
						/>
					</div>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{projectConfiguredProviders.length > 0 && (
						<div className="flex flex-col gap-2">
							<span className="font-medium text-sm">Configured Channels</span>
							<div className="flex flex-col gap-4">
								{projectConfiguredProviders.map(({ provider, config }) => (
									<ProjectNotificationProviderCard
										config={config}
										key={provider.id}
										project={project}
										provider={provider}
									/>
								))}
							</div>
						</div>
					)}
					{restProviders.length > 0 && (
						<div className="flex flex-col gap-2">
							<span className="font-medium text-sm">Available Channels</span>
							<div className="flex flex-col gap-4">
								{restProviders.map((provider) => (
									<ProjectNotificationProviderCard
										key={provider.id}
										project={project}
										provider={provider}
									/>
								))}
							</div>
						</div>
					)}
					{allProviders.length === 0 && (
						<Card className="flex h-17.5 max-w-none items-center rounded-lg p-4">
							<span className="text-muted-foreground text-sm">
								No providers configured. To set up a provider click on any of
								the providers above
							</span>
						</Card>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
