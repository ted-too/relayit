"use client";

import { Button } from "@repo/ui/components/shadcn/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@repo/ui/components/shadcn/dialog";
import { useState } from "react";
import { Email } from "@/components/icons";
import { CreateProviderForm } from "@/components/notification-providers/create";
import { ButtonWrapper, type NotificationProviderButtonProps } from ".";

export function EmailProvider({ configured }: NotificationProviderButtonProps) {
	const [isOpen, setIsOpen] = useState(false);
	return (
		<Dialog onOpenChange={setIsOpen} open={isOpen}>
			<ButtonWrapper configured={configured}>
				<DialogTrigger asChild>
					<Button className="font-semibold" size="lg" variant="secondary">
						<Email />
						<span>Email</span>
					</Button>
				</DialogTrigger>
			</ButtonWrapper>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Email</DialogTitle>
					<DialogDescription>
						Create a new email provider to send emails to your users.
					</DialogDescription>
				</DialogHeader>
				<CreateProviderForm
					channelType="email"
					onSuccess={() => setIsOpen(false)}
					submitWrapper={DialogFooter}
				/>
			</DialogContent>
		</Dialog>
	);
}
