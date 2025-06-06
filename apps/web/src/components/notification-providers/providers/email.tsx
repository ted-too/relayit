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

export function EmailProvider({ configured }: NotificationProviderButtonProps) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<ButtonWrapper configured={configured}>
					<Button variant="secondary" size="lg" className="font-semibold">
						<Email />
						<span>Email</span>
					</Button>
				</ButtonWrapper>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Email</DialogTitle>
					<DialogDescription>
						Create a new email provider to send emails to your users.
					</DialogDescription>
				</DialogHeader>
				<CreateProviderForm submitWrapper={DialogFooter} channelType="email" />
			</DialogContent>
		</Dialog>
	);
}
