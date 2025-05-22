import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Discord } from "@/components/icons";
import { ComingSoon } from "@/components/shared/comming-soon";
import type { NotificationProviderButtonProps } from ".";

export function DiscordProvider({
	configured,
}: NotificationProviderButtonProps) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<ComingSoon>
					<Button
						variant="secondary"
						size="lg"
						className="font-semibold bg-[#5865F2] hover:bg-[#5865F2]/90 text-white relative"
						disabled
					>
						<Discord />
						<span>Discord</span>
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
