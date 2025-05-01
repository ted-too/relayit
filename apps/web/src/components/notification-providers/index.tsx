"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
	type Provider,
	providersListQueryOptions,
} from "@/qc/queries/providers";
import { EmailProvider } from "@/components/notification-providers/email";
import { SmsProvider } from "./sms";
import { WhatsappProvider } from "./whatsapp";
import { DiscordProvider } from "./discord";

function ProviderCard({ provider }: { provider: Provider }) {
	return null;
}

export function ProvidersCardContent() {
	const { data: rawProviders, isPending } = useQuery(
		providersListQueryOptions(),
	);

	const providers = rawProviders ?? [];
	return (
		<CardContent className="flex flex-col gap-4">
			<div className="flex flex-col gap-2 rounded-lg min-h-[25vh]">
				<span className="text-base font-medium pl-1">Available Providers</span>
				<div className="flex items-center bg-sidebar p-1 w-full rounded-lg">
					<div className="flex items-center gap-4 p-3.5 rounded-lg bg-background border w-full">
						<EmailProvider />
						<SmsProvider />
						<WhatsappProvider />
						<DiscordProvider />
					</div>
				</div>
				<div className="flex flex-col gap-2">
					{!isPending && (
						<span className="text-base font-medium pl-1">
							{providers.length > 0
								? "Configured Providers"
								: "No providers configured"}
						</span>
					)}
					<div className="flex flex-col gap-4 rounded-lg bg-sidebar p-1">
						{isPending ? (
							<Skeleton className="w-full h-17.5" />
						) : providers.length > 0 ? (
							providers.map((provider) => (
								<ProviderCard key={provider.id} provider={provider} />
							))
						) : (
							<Card className="h-17.5 flex items-center p-4 rounded-lg">
								<span className="text-sm text-muted-foreground">
									To set up a provider click on any of the providers above
								</span>
							</Card>
						)}
					</div>
				</div>
			</div>
		</CardContent>
	);
}
