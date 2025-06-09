"use client";

import { Email } from "@/components/icons";
import { CreateProviderForm } from "@/components/notification-providers/create";
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
import { ButtonWrapper, type NotificationProviderButtonProps } from ".";
import { useState } from "react";

export function EmailProvider({ configured }: NotificationProviderButtonProps) {
	const [isOpen, setIsOpen] = useState(false);
	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<ButtonWrapper configured={configured}>
				<DialogTrigger asChild>
					<Button variant="secondary" size="lg" className="font-semibold">
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
					submitWrapper={DialogFooter}
					channelType="email"
					onSuccess={() => setIsOpen(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}
