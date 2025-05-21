"use client";

import type { NotificationProvider } from "@repo/db";
import { Card } from "@/components/ui/card";
import {
	Email,
	Sms,
	Discord,
	Whatsapp,
	type IconProps,
} from "@/components/icons";
import { format } from "date-fns";
import { PencilIcon, TrashIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreateProviderForm } from "@/components/notification-providers/create";
import { useState } from "react";

const ICONS: Record<
	NotificationProvider["channelType"],
	React.ComponentType<IconProps>
> = {
	email: Email,
	sms: Sms,
	discord: Discord,
	whatsapp: Whatsapp,
};

export function NotificationProviderCard({
	provider,
}: {
	provider: NotificationProvider;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const Icon = ICONS[provider.channelType];

	return (
		<Card className="h-17.5 flex items-center w-full justify-between p-4 rounded-lg">
			<div className="flex items-center gap-3">
				<Icon className="size-5" />
				<div className="flex flex-col gap-1">
					<span className="text-sm font-medium">{provider.name}</span>
					<div className="flex items-center gap-1">
						{provider.providerType !== "default" && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Badge variant="outline">{provider.providerType}</Badge>
								</TooltipTrigger>
								<TooltipContent side="bottom" align="center">
									Provider type
								</TooltipContent>
							</Tooltip>
						)}
						<span className="text-xs text-muted-foreground">
							{format(provider.createdAt, "dd-MM-yyyy HH:mm:ss aa")}
						</span>
					</div>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Dialog open={isOpen} onOpenChange={setIsOpen}>
					<DialogTrigger asChild>
						<Button variant="ghost" size="icon">
							<PencilIcon />
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Edit provider</DialogTitle>
							<DialogDescription>
								Currently editing the provider: {provider.name}
							</DialogDescription>
						</DialogHeader>
						<CreateProviderForm
							submitWrapper={DialogFooter}
							onSuccess={() => setIsOpen(false)}
							channelType={provider.channelType}
							initialData={provider}
						/>
					</DialogContent>
				</Dialog>
				<Button variant="ghost-destructive" size="icon">
					<TrashIcon />
				</Button>
			</div>
		</Card>
	);
}
