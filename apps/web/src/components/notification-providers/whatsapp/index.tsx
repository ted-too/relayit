import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ComingSoon } from "@/components/shared/comming-soon";
import { Whatsapp } from "@/components/icons";

export function WhatsappProvider() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<ComingSoon>
					<Button
						variant="secondary"
						size="lg"
						className="font-semibold bg-[#25D366] hover:bg-[#25D366]/90 text-white"
						disabled
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
