"use client";

import type { NotificationProvider, ProjectDetails } from "@repo/db";
import { Card } from "@/components/ui/card";
import {
	Email,
	Sms,
	Discord,
	Whatsapp,
	type IconProps,
} from "@/components/icons";
import { PencilIcon, TrashIcon, UnlinkIcon } from "lucide-react";
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
import {
	CreateProjectProviderAssociationForm,
	CreateProviderForm,
} from "@/components/notification-providers/create";
import type { ProjectProviderAssociation } from "@repo/db";
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
			<div className="flex items-center gap-2">
				<Icon className="size-5" />
				<div className="flex items-center gap-1">
					{provider.providerType !== "default" && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Badge variant="outline">{provider.providerType}</Badge>
							</TooltipTrigger>
							<TooltipContent side="bottom" align="center">
								{provider.providerType} provider
							</TooltipContent>
						</Tooltip>
					)}
					{provider.orgDefault && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Badge variant="light-positive">Default</Badge>
							</TooltipTrigger>
							<TooltipContent side="bottom" align="center">
								Default provider for {provider.channelType}
							</TooltipContent>
						</Tooltip>
					)}
				</div>
				<span className="text-sm font-medium">{provider.name}</span>
			</div>
			<div className="flex items-center gap-2">
				<Dialog open={isOpen} onOpenChange={setIsOpen}>
					<DialogTrigger asChild>
						<Button variant="ghost" size="icon">
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
							submitWrapper={DialogFooter}
							channelType={provider.channelType}
							initialData={provider}
							onSuccess={() => setIsOpen(false)}
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
	const Icon = ICONS[provider.channelType];

	return (
		<Card className="h-17.5 flex items-center max-w-none justify-between p-4 rounded-lg">
			<div className="flex items-center gap-2">
				<Icon className="size-5" />
				<div className="flex items-center gap-1">
					{provider.providerType !== "default" && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Badge variant="outline">{provider.providerType}</Badge>
							</TooltipTrigger>
							<TooltipContent side="bottom" align="center">
								{provider.providerType} provider
							</TooltipContent>
						</Tooltip>
					)}
					{provider.orgDefault && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Badge variant="light-positive">Default</Badge>
							</TooltipTrigger>
							<TooltipContent side="bottom" align="center">
								Default organization provider
							</TooltipContent>
						</Tooltip>
					)}
				</div>
				<span className="text-sm font-medium">{provider.name}</span>
			</div>
			<div className="flex items-center gap-2">
				<Dialog open={isOpen} onOpenChange={setIsOpen}>
					<DialogTrigger asChild>
						{config ? (
							<Button variant="ghost" size="icon">
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
							submitWrapper={DialogFooter}
							initialData={config}
							provider={provider}
							project={project}
							onSuccess={() => setIsOpen(false)}
						/>
					</DialogContent>
				</Dialog>
				{config && (
					<Button variant="ghost-destructive" size="icon">
						<UnlinkIcon />
					</Button>
				)}
			</div>
		</Card>
	);
}
