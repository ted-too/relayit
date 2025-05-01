import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageText } from "iconsax-react";

export function SmsProvider() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="secondary" size="lg" className="font-semibold">
					<MessageText variant="Bold" color="currentColor" />
					<span>SMS</span>
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Are you absolutely sure?</DialogTitle>
					<DialogDescription>
						This action cannot be undone. This will permanently delete your
						account and remove your data from our servers.
					</DialogDescription>
				</DialogHeader>
			</DialogContent>
		</Dialog>
	);
}
