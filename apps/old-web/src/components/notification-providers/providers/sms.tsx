"use client";

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
import { MessageText } from "iconsax-react";
import { ButtonWrapper, type NotificationProviderButtonProps } from ".";
import { useState } from "react";

export function SmsProvider({ configured }: NotificationProviderButtonProps) {
	const [isOpen, setIsOpen] = useState(false);
	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<ButtonWrapper configured={configured}>
				<DialogTrigger asChild>
					<Button variant="secondary" size="lg" className="font-semibold">
						<MessageText variant="Bold" color="currentColor" />
						<span>SMS</span>
					</Button>
				</DialogTrigger>
			</ButtonWrapper>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>SMS</DialogTitle>
					<DialogDescription>
						Create a new SMS provider to send text messages to your users.
					</DialogDescription>
				</DialogHeader>
				<CreateProviderForm
					submitWrapper={DialogFooter}
					channelType="sms"
					onSuccess={() => setIsOpen(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}
