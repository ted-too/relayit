import { CreateProviderForm } from "@/components/notification-providers/create";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { MessageText } from "iconsax-react";
import { ButtonWrapper, type NotificationProviderButtonProps } from ".";

export function SmsProvider({ configured }: NotificationProviderButtonProps) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<ButtonWrapper configured={configured}>
					<Button variant="secondary" size="lg" className="font-semibold">
						<MessageText variant="Bold" color="currentColor" />
						<span>SMS</span>
					</Button>
				</ButtonWrapper>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>SMS</DialogTitle>
					<DialogDescription>
						Create a new SMS provider to send text messages to your users.
					</DialogDescription>
				</DialogHeader>
				<CreateProviderForm submitWrapper={DialogFooter} channelType="sms" />
			</DialogContent>
		</Dialog>
	);
}
