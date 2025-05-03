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
import { Email } from "@/components/icons";
import { CreateProviderForm } from "@/components/notification-providers/create";
import { useState } from "react";

export function EmailProvider() {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button variant="secondary" size="lg" className="font-semibold">
					<Email />
					<span>Email</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Email</DialogTitle>
					<DialogDescription>
						Create a new email provider to send emails to your users.
					</DialogDescription>
				</DialogHeader>
				<CreateProviderForm
					submitWrapper={DialogFooter}
					onSuccess={() => setIsOpen(false)}
					channelType="email"
				/>
			</DialogContent>
		</Dialog>
	);
}
