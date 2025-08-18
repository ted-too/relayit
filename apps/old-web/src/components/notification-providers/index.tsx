"use client";

import { Card, CardContent } from "@repo/old-ui/components/shadcn/card";
import { Skeleton } from "@repo/old-ui/components/shadcn/skeleton";
import { NotificationProviderCard } from "@/components/notification-providers/card";
import { EmailProvider } from "@/components/notification-providers/providers/email";
import { trpc } from "@/trpc/client";
import { DiscordProvider } from "./providers/discord";
import { SmsProvider } from "./providers/sms";
import { WhatsappProvider } from "./providers/whatsapp";

export function ProvidersCardContent() {
	const { data: rawProviders, isPending } = trpc.providers.list.useQuery();

	const providers = rawProviders ?? [];
	return (
		<CardContent className="flex flex-col gap-4">
			<div className="flex min-h-[25vh] flex-col gap-2 rounded-lg">
				<span className="pl-1 font-medium text-base">Available Providers</span>
				<div className="w-full rounded-lg bg-sidebar p-1">
					<div className="flex w-full items-center gap-4 rounded-lg border bg-background p-3.5">
						<EmailProvider />
						<SmsProvider />
						<WhatsappProvider />
						<DiscordProvider />
					</div>
				</div>
				<div className="flex flex-col gap-1">
					{isPending ? (
						<Skeleton className="ml-1 h-6 w-1/4" />
					) : (
						<span className="pl-1 font-medium text-base">
							{providers.length > 0
								? "Configured Providers"
								: "No providers configured"}
						</span>
					)}
					{isPending ? (
						<div className="w-full rounded-lg bg-sidebar p-1">
							<Skeleton className="h-17.5 w-full" />
						</div>
					) : providers.length > 0 ? (
						providers.map((provider) => (
							<div
								className="w-full rounded-lg bg-sidebar p-1"
								key={provider.id}
							>
								<NotificationProviderCard provider={provider} />
							</div>
						))
					) : (
						<div className="w-full rounded-lg bg-sidebar p-1">
							<Card className="flex h-17.5 items-center rounded-lg p-4">
								<span className="text-muted-foreground text-sm">
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
