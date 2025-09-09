"use client";

import type {
	NotificationProvider,
	ProjectDetails,
	ProjectProviderAssociation,
} from "@repo/db";
import { Badge } from "@repo/old-ui/components/shadcn/badge";
import { Button } from "@repo/old-ui/components/shadcn/button";
import { Card } from "@repo/old-ui/components/shadcn/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@repo/old-ui/components/shadcn/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@repo/old-ui/components/shadcn/tooltip";
import { PencilIcon, TrashIcon, UnlinkIcon } from "lucide-react";
import { useState } from "react";
import {
	Discord,
	Email,
	type IconProps,
	Sms,
	Whatsapp,
} from "@/components/icons";
import {
	CreateProjectProviderAssociationForm,
	CreateProviderForm,
} from "@/components/notification-providers/create";

const ICONS: Record<
	NotificationProvider["channelType"],
	React.ComponentType<IconProps>
> = {
	email: Email,
	sms: Sms,
	discord: Discord,
	whatsapp: Whatsapp,
};

function ProviderTitle({ provider }: { provider: NotificationProvider }) {
	const Icon = ICONS[provider.channelType];

	return (
		<div className="flex items-center gap-2">
			<Tooltip>
				<TooltipTrigger asChild>
					<Icon className="size-5" />
				</TooltipTrigger>
				<TooltipContent align="center" side="bottom">
					{provider.channelType} provider
				</TooltipContent>
			</Tooltip>
			<div className="flex items-center gap-1">
				{provider.providerType !== "default" && (
					<Badge variant="outline">{provider.providerType}</Badge>
				)}
				{provider.orgDefault && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Badge variant="light-positive">Default</Badge>
						</TooltipTrigger>
						<TooltipContent align="center" side="bottom">
							Default organization provider
						</TooltipContent>
					</Tooltip>
				)}
			</div>
			<span className="font-medium text-sm">{provider.name}</span>
		</div>
	);
}

export function NotificationProviderCard({
	provider,
}: {
	provider: NotificationProvider;
}) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<Card className="flex h-17.5 w-full items-center justify-between rounded-lg p-4">
			<ProviderTitle provider={provider} />
			<div className="flex items-center gap-2">
				<Dialog onOpenChange={setIsOpen} open={isOpen}>
					<DialogTrigger asChild>
						<Button size="icon" variant="ghost">
							<PencilIcon />
						</Button>
					</DialogTrigger>
					<DialogContent className="sm:max-w-2xl">
						<DialogHeader>
							<DialogTitle>Edit provider</DialogTitle>
							<DialogDescription>
								Currently editing the provider: {provider.name}
							</DialogDescription>
						</DialogHeader>
						<CreateProviderForm
							channelType={provider.channelType}
							initialData={provider}
							onSuccess={() => setIsOpen(false)}
							submitWrapper={DialogFooter}
						/>
					</DialogContent>
				</Dialog>
				<Button size="icon" variant="ghost-destructive">
					<TrashIcon />
				</Button>
			</div>
		</Card>
	);
}

export function ProjectNotificationProviderCard({
	config,
	provider,
	project,
}: {
	config?: ProjectProviderAssociation;
	provider: NotificationProvider;
	project: ProjectDetails;
}) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<Card className="flex h-17.5 max-w-none items-center justify-between rounded-lg p-4">
			<ProviderTitle provider={provider} />
			<div className="flex items-center gap-2">
				<Dialog onOpenChange={setIsOpen} open={isOpen}>
					<DialogTrigger asChild>
						{config ? (
							<Button size="icon" variant="ghost">
								<PencilIcon />
							</Button>
						) : (
							<Button variant="outline">Configure</Button>
						)}
					</DialogTrigger>
					<DialogContent className="sm:max-w-2xl">
						<DialogHeader>
							<DialogTitle>Configure provider</DialogTitle>
							<DialogDescription>
								Currently configuring the provider: {provider.name}
							</DialogDescription>
						</DialogHeader>
						<CreateProjectProviderAssociationForm
							initialData={config}
							onSuccess={() => setIsOpen(false)}
							project={project}
							provider={provider}
							submitWrapper={DialogFooter}
						/>
					</DialogContent>
				</Dialog>
				{config && (
					<Button size="icon" variant="ghost-destructive">
						<UnlinkIcon />
					</Button>
				)}
			</div>
		</Card>
	);
}
