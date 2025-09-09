"use client";

import { Button } from "@repo/old-ui/components/shadcn/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@repo/old-ui/components/shadcn/dialog";
import { MessageText } from "iconsax-react";
import { useState } from "react";
import { CreateProviderForm } from "@/components/notification-providers/create";
import { ButtonWrapper, type NotificationProviderButtonProps } from ".";

export function SmsProvider({ configured }: NotificationProviderButtonProps) {
	const [isOpen, setIsOpen] = useState(false);
	return (
		<Dialog onOpenChange={setIsOpen} open={isOpen}>
			<ButtonWrapper configured={configured}>
				<DialogTrigger asChild>
					<Button className="font-semibold" size="lg" variant="secondary">
						<MessageText color="currentColor" variant="Bold" />
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
					channelType="sms"
					onSuccess={() => setIsOpen(false)}
					submitWrapper={DialogFooter}
				/>
			</DialogContent>
		</Dialog>
	);
}
