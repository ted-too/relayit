"use client";

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
import { MessageText } from "iconsax-react";
import { CreateProviderForm } from "@/components/notification-providers/create";
import { useState } from "react";

export function SmsProvider() {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button variant="secondary" size="lg" className="font-semibold">
					<MessageText variant="Bold" color="currentColor" />
					<span>SMS</span>
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>SMS</DialogTitle>
					<DialogDescription>
						Create a new SMS provider to send text messages to your users.
					</DialogDescription>
				</DialogHeader>
				<CreateProviderForm
					submitWrapper={DialogFooter}
					onSuccess={() => setIsOpen(false)}
					channelType="sms"
				/>
			</DialogContent>
		</Dialog>
	);
}
