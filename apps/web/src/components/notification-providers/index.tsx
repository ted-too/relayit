"use client";

import { NotificationProviderCard } from "@/components/notification-providers/card";
import { EmailProvider } from "@/components/notification-providers/providers/email";
import { Card, CardContent } from "@repo/ui/components/shadcn/card";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import { trpc } from "@/trpc/client";
import { DiscordProvider } from "./providers/discord";
import { SmsProvider } from "./providers/sms";
import { WhatsappProvider } from "./providers/whatsapp";

export function ProvidersCardContent() {
	const { data: rawProviders, isPending } = trpc.providers.list.useQuery();

	const providers = rawProviders ?? [];
	return (
		<CardContent className="flex flex-col gap-4">
			<div className="flex flex-col gap-2 rounded-lg min-h-[25vh]">
				<span className="text-base font-medium pl-1">Available Providers</span>
				<div className="bg-sidebar p-1 w-full rounded-lg">
					<div className="flex items-center gap-4 p-3.5 rounded-lg bg-background border w-full">
						<EmailProvider />
						<SmsProvider />
						<WhatsappProvider />
						<DiscordProvider />
					</div>
				</div>
				<div className="flex flex-col gap-1">
					{isPending ? (
						<Skeleton className="w-1/4 h-6 ml-1" />
					) : (
						<span className="text-base font-medium pl-1">
							{providers.length > 0
								? "Configured Providers"
								: "No providers configured"}
						</span>
					)}
					{isPending ? (
						<div className="bg-sidebar p-1 w-full rounded-lg">
							<Skeleton className="w-full h-17.5" />
						</div>
					) : providers.length > 0 ? (
						providers.map((provider) => (
							<div
								key={provider.id}
								className="bg-sidebar p-1 w-full rounded-lg"
							>
								<NotificationProviderCard provider={provider} />
							</div>
						))
					) : (
						<div className="bg-sidebar p-1 w-full rounded-lg">
							<Card className="h-17.5 flex items-center p-4 rounded-lg">
								<span className="text-sm text-muted-foreground">
									To set up a provider click on any of the providers above
								</span>
							</Card>
						</div>
					)}
				</div>
			</div>
		</CardContent>
	);
}
