import { Button } from "@repo/ui/components/shadcn/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@repo/ui/components/shadcn/dialog";
import { Whatsapp } from "@/components/icons";
import { ComingSoon } from "@/components/shared/comming-soon";
import type { NotificationProviderButtonProps } from ".";

export function WhatsappProvider({
	configured,
}: NotificationProviderButtonProps) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<ComingSoon>
					<Button
						className="bg-[#25D366] font-semibold text-white hover:bg-[#25D366]/90"
						disabled
						size="lg"
						variant="secondary"
					>
						<Whatsapp />
						<span>Whatsapp</span>
					</Button>
				</ComingSoon>
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
