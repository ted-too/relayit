import { Button } from "@repo/ui/components/shadcn/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@repo/ui/components/shadcn/dialog";
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
						className="relative bg-[#5865F2] font-semibold text-white hover:bg-[#5865F2]/90"
						disabled
						size="lg"
						variant="secondary"
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
